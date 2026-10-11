import * as mupdf from 'mupdf';
import type { OpenResult, PageInfo } from '../shared/types';

const PDF_MIME = 'application/pdf';

function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String(e);
}

/** One open document inside the engine worker. No DOM, no React. */
export class EngineSession {
  private current: mupdf.PDFDocument | null = null;
  private originalBytes: Uint8Array | null = null;
  private password: string | undefined;

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
    this.originalBytes = bytes;
    this.password = password;
    return { status: 'ok', pages: this.pageInfo(), repaired: doc.wasRepaired() };
  }

  /** Reopens the original bytes (used to rebuild before replaying ops). */
  reopenFrom(bytes: Uint8Array): void {
    const doc = mupdf.Document.openDocument(bytes, PDF_MIME).asPDF();
    if (!doc) throw new Error('Checkpoint is not a PDF');
    if (doc.needsPassword() && this.password !== undefined) {
      doc.authenticatePassword(this.password);
    }
    this.current?.destroy();
    this.current = doc;
  }

  get original(): Uint8Array {
    if (!this.originalBytes) throw new Error('No document is open');
    return this.originalBytes;
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

  save(): Uint8Array {
    const options =
      this.password === undefined ? 'garbage,compress' : 'garbage,compress,encrypt=keep';
    const buffer = this.doc.saveToBuffer(options);
    const bytes = buffer.asUint8Array().slice();
    buffer.destroy();
    return bytes;
  }

  close(): void {
    this.current?.destroy();
    this.current = null;
    this.originalBytes = null;
    this.password = undefined;
  }
}
