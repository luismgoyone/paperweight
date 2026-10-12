import * as mupdf from 'mupdf';
import { DESTRUCTIVE_KINDS, type Op, type OpenResult, type PageInfo } from '../shared/types';
import { ENGINE_BROKEN } from './api';
import { downsampleImages } from './compress';
import { graftPages } from './graft';
import { applyOp, pagesTouched } from './ops';

const PDF_MIME = 'application/pdf';
const CHECKPOINT_EVERY = 20;

export type ChangedPages = number[] | 'all';

export type Permissions = {
  print: boolean;
  copy: boolean;
  edit: boolean;
  annotate: boolean;
  forms: boolean;
};

/** Password protection on export (spec §6 Phase 6). */
export type Security =
  | { kind: 'remove' }
  | { kind: 'set'; userPassword: string; ownerPassword: string; permissions: Permissions };

export type SaveOptions = {
  /** Bake annotations into the page content. */
  flatten?: boolean;
  /** Bake form fields into the page content. */
  flattenForms?: boolean;
  /** Change protection; by default a protected file stays protected the same way. */
  security?: Security;
};

/** PDF permission bits (ISO 32000 table 22). Accessibility extraction is always allowed. */
function permissionBits(p: Permissions): number {
  let bits = 512; // extract for accessibility
  if (p.print) bits |= 4 | 2048; // print, high quality
  if (p.edit) bits |= 8 | 1024; // modify, assemble
  if (p.copy) bits |= 16;
  if (p.annotate) bits |= 32;
  if (p.forms || p.annotate) bits |= 256;
  return bits;
}

function checkOptionValue(value: string, what: string): string {
  if (/[,=]/.test(value)) throw new Error(`The ${what} can't contain a comma or "=".`);
  return value;
}

function toBytes(buffer: mupdf.Buffer): Uint8Array {
  const bytes = buffer.asUint8Array().slice();
  buffer.destroy();
  return bytes;
}

const sameOp = (a: Op, b: Op) => a === b || JSON.stringify(a) === JSON.stringify(b);

function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String(e);
}

/** One open document inside the engine worker. No DOM, no React. */
export class EngineSession {
  private current: mupdf.PDFDocument | null = null;
  private password: string | undefined;
  private applied: Op[] = [];
  // Op count -> document bytes after that many ops (spec §3.3). 0 is the original file.
  private checkpoints = new Map<number, Uint8Array>();

  get doc(): mupdf.PDFDocument {
    if (!this.current) throw new Error('No document is open');
    return this.current;
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  open(bytes: Uint8Array, password?: string): OpenResult {
    let doc: mupdf.PDFDocument | null;
    try {
      doc = mupdf.Document.openDocument(bytes, PDF_MIME).asPDF();
    } catch (e) {
      return { status: 'error', message: errorMessage(e) };
    }
    if (!doc) return { status: 'error', message: 'This file is not a PDF.' };

    if (doc.needsPassword()) {
      if (password === undefined) {
        doc.destroy();
        return { status: 'needs-password' };
      }
      if (doc.authenticatePassword(password) === 0) {
        doc.destroy();
        return { status: 'wrong-password' };
      }
    }

    try {
      // Force page-tree parsing now so damaged files fail here, not mid-render.
      doc.countPages();
    } catch (e) {
      doc.destroy();
      return { status: 'error', message: errorMessage(e) };
    }

    this.close();
    this.current = doc;
    this.password = password;
    this.checkpoints.set(0, bytes);
    return {
      status: 'ok',
      pages: this.pageInfo(),
      repaired: doc.wasRepaired(),
      hasForm: this.hasForm(),
    };
  }

  get checkpointIndices(): number[] {
    return [...this.checkpoints.keys()].filter((k) => k > 0).sort((a, b) => a - b);
  }

  /**
   * Converges the live document to "original + target ops". Appended ops are applied
   * incrementally; anything else (undo, branch) replays from the nearest checkpoint.
   * If an op fails, the document is restored to its previous state and OpError is thrown.
   */
  setOps(target: Op[]): { changedPages: ChangedPages } {
    const previous = this.applied;
    let prefix = 0;
    while (
      prefix < previous.length &&
      prefix < target.length &&
      sameOp(previous[prefix]!, target[prefix]!)
    ) {
      prefix++;
    }
    for (const k of this.checkpoints.keys()) if (k > prefix) this.checkpoints.delete(k);

    try {
      if (prefix === previous.length) {
        this.applyFrom(prefix, target);
        const touched = target.slice(prefix).map(pagesTouched);
        if (touched.includes('all')) return { changedPages: 'all' };
        return { changedPages: [...new Set((touched as number[][]).flat())] };
      }
      this.replay(target, prefix);
      return { changedPages: 'all' };
    } catch (e) {
      for (const k of this.checkpoints.keys()) if (k > prefix) this.checkpoints.delete(k);
      try {
        this.replay(previous, prefix);
      } catch (restoreError) {
        // The live document can't be trusted any more; the UI restarts the engine.
        this.close();
        throw Object.assign(new Error(`Could not restore the document: ${String(restoreError)}`), {
          name: ENGINE_BROKEN,
        });
      }
      throw e;
    }
  }

  private replay(target: Op[], prefix: number): void {
    const start = Math.max(...[...this.checkpoints.keys()].filter((k) => k <= prefix));
    this.reopenFrom(this.checkpoints.get(start)!);
    this.applied = target.slice(0, start);
    this.applyFrom(start, target);
  }

  private applyFrom(start: number, target: Op[]): void {
    for (let i = start; i < target.length; i++) {
      const op = target[i]!;
      if (DESTRUCTIVE_KINDS.has(op.kind) && !this.checkpoints.has(i)) {
        this.checkpoints.set(i, this.snapshot());
      }
      applyOp(this.doc, op);
      this.applied = target.slice(0, i + 1);
      if ((i + 1) % CHECKPOINT_EVERY === 0) this.checkpoints.set(i + 1, this.snapshot());
    }
  }

  private snapshot(): Uint8Array {
    return toBytes(this.doc.saveToBuffer(''));
  }

  private reopenFrom(bytes: Uint8Array): void {
    const doc = mupdf.Document.openDocument(bytes, PDF_MIME).asPDF();
    if (!doc) throw new Error('Checkpoint is not a PDF');
    if (doc.needsPassword() && this.password !== undefined) {
      doc.authenticatePassword(this.password);
    }
    this.current?.destroy();
    this.current = doc;
  }

  /** Whether the document has fillable form fields (pages may bring some in). */
  hasForm(): boolean {
    const fields = this.doc.getTrailer().get('Root', 'AcroForm', 'Fields');
    return fields.isArray() && fields.length > 0;
  }

  /**
   * A new PDF of `pages` (extract / split). A password-protected document's extracts are
   * protected with the same password (AES-256), so extracting doesn't silently drop it.
   */
  extract(pages: number[]): Uint8Array {
    const out = new mupdf.PDFDocument();
    try {
      graftPages(out, 0, this.doc, pages);
      const pw = this.password;
      if (pw !== undefined && /[,=]/.test(pw)) {
        throw new Error(
          "This file's password contains a comma or '=', so extracted pages can't keep it.",
        );
      }
      const options =
        pw === undefined
          ? 'garbage,compress'
          : `garbage,compress,encrypt=aes-256,user-password=${pw},owner-password=${pw}`;
      return toBytes(out.saveToBuffer(options));
    } finally {
      out.destroy();
    }
  }

  pageInfo(): PageInfo[] {
    const doc = this.doc;
    const pages: PageInfo[] = [];
    for (let index = 0; index < doc.countPages(); index++) {
      const page = doc.loadPage(index);
      const [x0, y0, x1, y1] = page.getBounds();
      pages.push({ index, width: x1 - x0, height: y1 - y0 });
      page.destroy();
    }
    return pages;
  }

  /**
   * The final PDF bytes. `flatten` bakes annotations into the page content (spec §6 Phase 2);
   * it works on a copy, so the live document keeps its editable annotations.
   */
  /** MuPDF writer options for the final file. */
  private writeOptions(security?: Security, base = 'garbage,compress'): string {
    if (!security) return this.password === undefined ? base : `${base},encrypt=keep`;
    if (security.kind === 'remove') return `${base},decrypt`;
    const user = checkOptionValue(security.userPassword, 'password');
    const owner = checkOptionValue(security.ownerPassword || security.userPassword, 'password');
    if (!user && !owner) throw new Error('Enter a password');
    return `${base},encrypt=aes-256,user-password=${user},owner-password=${owner},permissions=${permissionBits(security.permissions)}`;
  }

  save(options: SaveOptions = {}): Uint8Array {
    const write = this.writeOptions(options.security);
    if (!options.flatten && !options.flattenForms) return toBytes(this.doc.saveToBuffer(write));

    const copy = new mupdf.PDFDocument(toBytes(this.doc.saveToBuffer(this.writeOptions())));
    try {
      if (copy.needsPassword() && this.password !== undefined)
        copy.authenticatePassword(this.password);
      copy.bake(Boolean(options.flatten), Boolean(options.flattenForms));
      return toBytes(copy.saveToBuffer(write));
    } finally {
      copy.destroy();
    }
  }

  /**
   * A smaller copy of the current document (spec §6 Phase 6): images shown at more than `dpi`
   * are resampled to it and re-encoded as JPEG when that's smaller, fonts are subset and
   * duplicate objects merged. Never larger than the current file; the open document is unchanged.
   */
  compress(options: { dpi: number }): { bytes: Uint8Array; before: number; after: number } {
    const original = this.save();
    const copy = new mupdf.PDFDocument(original);
    try {
      if (copy.needsPassword() && this.password !== undefined)
        copy.authenticatePassword(this.password);
      downsampleImages(copy, options.dpi);
      copy.subsetFonts();
      const bytes = toBytes(
        copy.saveToBuffer(this.writeOptions(undefined, 'garbage=deduplicate,compress')),
      );
      return bytes.length < original.length
        ? { bytes, before: original.length, after: bytes.length }
        : { bytes: original, before: original.length, after: original.length };
    } finally {
      copy.destroy();
    }
  }

  close(): void {
    this.current?.destroy();
    this.current = null;
    this.password = undefined;
    this.applied = [];
    this.checkpoints.clear();
  }
}
