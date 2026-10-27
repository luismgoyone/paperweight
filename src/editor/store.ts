import { create } from 'zustand';
import { downloadFileName, renamedFileName } from '../shared/filename';
import { range, type PageRange } from '../shared/ranges';
import type {
  FormField,
  Slot,
  ImageAsset,
  Op,
  PageInfo,
  Point,
  Quad,
  Rect,
  SearchHit,
  TextRun,
} from '../shared/types';
import { newId } from './ids';
import { createEngineClient, createSerialQueue, type EngineClient } from './engine-client';
import { buildDocx } from './docx';
import { loadFonts } from './fonts';
import { recognize } from './ocr';
import { History } from './history';
import type { SaveOptions } from '../engine/document';
import type { TextEditInfo } from '../engine/ops/text-add';
import { foldObjects, type EditorObject } from './objects';
import { useTools } from './tools';
import { objectOp } from './object-ops';
import { clampZoom, fitPage, fitWidth, type ZoomMode } from './zoom';

export const LARGE_FILE_BYTES = 200 * 1024 * 1024;
const MAX_RESTARTS = 3;

export type Status = 'empty' | 'loading' | 'password' | 'ready' | 'error';

export type SearchState = {
  query: string;
  hits: SearchHit[];
  /** Index into hits, or -1 when there are none. */
  active: number;
  searched: boolean;
};

export type EditorState = {
  engineReady: boolean;
  /** All bundled fonts are loaded in the browser and registered with the engine. */
  fontsReady: boolean;
  status: Status;
  error: string | null;
  passwordError: boolean;
  fileName: string;
  /** The user renamed the file, so downloads use fileName as-is. */
  renamed: boolean;
  /** Renames the open file (downloads and exports use the new name); blank names are ignored. */
  renameFile(name: string): void;
  /** The open document has fillable form fields. */
  hasForm: boolean;
  /** Changes every time a document is opened; keys in-memory render caches. */
  docId: number;
  pages: PageInfo[];
  /** Bumped per page when its rendering may have changed; views re-render on change. */
  pageVersions: number[];
  zoom: number;
  zoomMode: ZoomMode;
  currentPage: number;
  /** Set when something asks the viewer to scroll to a page; the viewer clears it. */
  scrollRequest: { page: number; y?: number } | null;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  search: SearchState;
  /** Increases whenever the op log changes (edits, undo, redo); keys page-indexed UI state. */
  revision: number;
  /** Objects added by the user (annotations, text), in drawing order. Derived from the op log. */
  objects: EditorObject[];
  toast: string | null;

  initEngine(): void;
  openFile(file: File): Promise<void>;
  submitPassword(password: string): Promise<void>;
  cancelPassword(): void;
  /** Applies an op; resolves false if it was rejected (the user has been told why). */
  commit(op: Op): Promise<boolean>;
  /** Resolves once every edit already started has been applied. */
  settled(): Promise<void>;
  /**
   * Changes an added object based on its latest committed state (`fn` returns the new object,
   * or null to delete it). Runs in order with other edits, so quick successive changes can't
   * overwrite each other with stale copies.
   */
  updateObject(id: string, fn: (o: EditorObject) => EditorObject | null): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  download(options?: SaveOptions): Promise<void>;
  /** Existing text on a page (cached per page version). */
  getTextRuns(page: number): Promise<TextRun[]>;
  /** Blank boxes and checkboxes detected on a page of a flat form. */
  getSlots(page: number): Promise<Slot[]>;
  selectText(page: number, a: Point, b: Point): Promise<Quad[]>;
  /** Which font an edited text object uses (null for added text). */
  getTextEditInfo(id: string): Promise<TextEditInfo | null>;
  /** Form widgets on a page with their current values. */
  getFields(page: number): Promise<FormField[]>;
  /** Inserts every page of a PDF before page `at` (merge). Asks for a password if needed. */
  insertDocument(file: File, at: number, password?: string): Promise<void>;
  /** Set while a PDF being inserted needs its password. */
  insertPassword: { fileName: string; wrong: boolean } | null;
  submitInsertPassword(password: string): void;
  cancelInsertPassword(): void;
  /** The open document was password-protected. */
  isProtected: boolean;
  /** A smaller copy of the document (not downloaded yet). */
  compress(dpi: number): Promise<{ bytes: Uint8Array; before: number; after: number }>;
  /** Downloads bytes produced by an export (e.g. compress) under the download file name. */
  saveExport(bytes: Uint8Array): void;
  /** OCR in progress: which page and how far (0..1). */
  ocr: { page: number; progress: number } | null;
  /**
   * Recognises the text on scanned pages and adds an invisible text layer (spec §6 Phase 7).
   * 'scanned' means every page that has an image but no text.
   */
  recognizePages(pages: number[] | 'scanned'): Promise<void>;
  cancelOcr(): void;
  /** Whether a page has images (to tell scans from blank pages). */
  pageHasImages(page: number): Promise<boolean>;
  /** Downloads a Word (.docx) version of the document (best-effort, spec §6 Phase 8). */
  exportWord(): Promise<void>;
  exportingWord: boolean;
  /** Applies every marked redaction (one op per page). */
  applyRedactions(marks: { page: number; rect: Rect }[]): Promise<void>;
  /** Downloads a new PDF made of these pages. */
  extractPages(pages: number[]): Promise<void>;
  /** Downloads one PDF per range (inclusive, 0-based). */
  split(ranges: PageRange[]): Promise<void>;
  /** Registers PNG/JPEG bytes for image ops (kept in memory for this tab only). */
  addImage(bytes: Uint8Array): Promise<ImageAsset>;
  setZoom(zoom: number): void;
  setZoomMode(mode: ZoomMode): void;
  applyFit(viewportW: number, viewportH: number): void;
  setCurrentPage(page: number): void;
  goToPage(page: number): void;
  clearScrollRequest(): void;
  runSearch(query: string): Promise<void>;
  nextHit(): void;
  prevHit(): void;
  clearSearch(): void;
  showToast(message: string): void;
  dismissToast(): void;
  /** Exposed for the engine-dependent views (rendering, thumbnails). */
  render(page: number, scale: number, signal?: AbortSignal): Promise<ImageBitmap>;
};

const EMPTY_SEARCH: SearchState = { query: '', hits: [], active: -1, searched: false };

// Non-reactive session state: the engine handle, the op log and the open file's bytes.
// All of it lives in memory only and is dropped with the tab (spec §2).
let engine: EngineClient | null = null;
const history = new History();
type Source = { bytes: Uint8Array; name: string; password?: string };
/** The document that is open in the engine. */
let source: Source | null = null;
/** A file being opened (e.g. waiting for its password); replaces `source` only once it opens. */
let pending: Source | null = null;
let restarts = 0;
// Images placed this session, by key, so a restarted engine can be given them again.
const images = new Map<string, Uint8Array>();
// PDFs inserted this session (merge), by key, for the same reason.
const documents = new Map<string, { bytes: Uint8Array; password?: string }>();
// A PDF being inserted that is waiting for its password.
let pendingInsert: { key: string; bytes: Uint8Array; file: File; at: number } | null = null;
let inserting = false;
let ocrCancelled = false;
/** Resolves when the current engine has every bundled font (text ops need them). */
let fontsRegistered: Promise<void> = Promise.resolve();
// History changes and the engine sync that follows them run one at a time, so a failed op
// is always the last one pushed and a download always saves the state it marks as saved.
const exclusive = createSerialQueue();

/** Hands bytes to the browser as a download. The output file is the only thing that leaves the tab. */
function saveFile(data: Uint8Array | Blob, name: string): void {
  const blob =
    data instanceof Blob ? data : new Blob([data as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const baseName = (name: string) =>
  name

    .trim()
    .replace(/\.pdf$/i, '')
    .trim() || 'document';

/** "3", "2-5" for a contiguous run, otherwise "1_4_7" (so "1-5" never means pages 1 and 5). */
function pageLabel(sorted: number[]): string {
  const first = sorted[0]! + 1;
  const last = sorted[sorted.length - 1]! + 1;
  if (sorted.length === 1) return `${first}`;
  const contiguous = sorted.every((p, i) => i === 0 || p === sorted[i - 1]! + 1);
  return contiguous ? `${first}-${last}` : sorted.map((p) => p + 1).join('_');
}

function engineOrThrow(): EngineClient {
  if (!engine) throw new Error('The PDF engine is not running');
  return engine;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useEditor = create<EditorState>()((set, get) => {
  // Page changes invalidate page-indexed UI state.
  const afterPageChange = () => {
    // Marks are page-indexed: after pages move they'd point at the wrong content.
    useTools.getState().clearRedactMarks();
    const last = get().pages.length - 1;
    set({ search: EMPTY_SEARCH, currentPage: Math.min(get().currentPage, Math.max(0, last)) });
  };

  const historyFlags = () => ({
    revision: get().revision + 1,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    dirty: history.dirty,
    objects: [...foldObjects(history.active).values()],
  });

  const textRunCache = new Map<string, Promise<TextRun[]>>();
  const slotCache = new Map<string, Promise<Slot[]>>();

  const bumpPages = (changed: number[] | 'all', pages = get().pages) => {
    const prev = get().pageVersions;
    const versions = pages.map((_, i) => prev[i] ?? 0);
    const targets = changed === 'all' ? versions.map((_, i) => i) : changed;
    for (const i of targets) if (i < versions.length) versions[i] = versions[i]! + 1;
    set({ pages, pageVersions: versions });
  };

  const sync = async () => {
    const { changedPages, pages, hasForm } = await engineOrThrow().setOps(history.active);
    bumpPages(changedPages, pages);
    if (hasForm !== get().hasForm) set({ hasForm });
    set(historyFlags());
  };

  const registerFonts = async (client: EngineClient) => {
    const fonts = await loadFonts();
    await Promise.all([...fonts].map(([id, bytes]) => client.registerFont(id, bytes)));
  };

  /** Registers a PDF to insert (asking for its password if needed) and inserts all its pages. */
  const insertOne = async (file: File, at: number, password?: string) => {
    // Reuse the bytes only when retrying the same file with a password.
    const retry = pendingInsert && pendingInsert.file === file ? pendingInsert : null;
    const key = retry?.key ?? newId();
    const bytes = retry?.bytes ?? new Uint8Array(await file.arrayBuffer());
    const result = await engineOrThrow().registerDocument(key, bytes, password);
    switch (result.status) {
      case 'ok':
        pendingInsert = null;
        set({ insertPassword: null });
        documents.set(key, { bytes, password });
        await get().commit({
          kind: 'page.insertFrom',
          at,
          source: key,
          pages: Array.from({ length: result.pageCount }, (_, i) => i),
        });
        get().showToast(
          `Inserted ${result.pageCount} page${result.pageCount === 1 ? '' : 's'} from "${file.name}".`,
        );
        return;
      case 'needs-password':
      case 'wrong-password':
        pendingInsert = { key, bytes, file, at };
        set({
          insertPassword: { fileName: file.name, wrong: result.status === 'wrong-password' },
        });
        return;
      case 'error':
        pendingInsert = null;
        set({ insertPassword: null });
        get().showToast(`"${file.name}" could not be opened as a PDF. (${result.message})`);
    }
  };

  const startEngine = () => {
    const client = createEngineClient();
    engine = client;
    set({ engineReady: false });
    fontsRegistered = registerFonts(client);
    fontsRegistered.then(
      () => {
        if (engine === client) set({ fontsReady: true });
      },
      (e) => {
        if (engine === client) get().showToast(`Fonts failed to load: ${messageOf(e)}`);
      },
    );
    client.ready.then(
      () => {
        if (engine === client) set({ engineReady: true });
      },
      (e) => set({ status: 'error', error: `The PDF engine failed to load: ${messageOf(e)}` }),
    );
    client.onCrash(() => void recover(client));
    return client;
  };

  // Spec §7: restart the worker, reopen the original, replay the op log. No edits are lost.
  const recover = async (crashed: EngineClient) => {
    if (engine !== crashed) return;
    crashed.terminate();
    if (++restarts > MAX_RESTARTS) {
      engine = null;
      set({
        status: 'error',
        error: 'The PDF engine keeps crashing. Reload the page to try again.',
      });
      return;
    }
    const client = startEngine();
    pending = null;
    if (get().status === 'password' || get().status === 'loading') {
      set({ status: source ? 'ready' : 'empty', passwordError: false });
    }
    if (!source) return;
    try {
      await Promise.all([...images].map(([key, bytes]) => client.registerImage(key, bytes)));
      await Promise.all(
        [...documents].map(([key, d]) => client.registerDocument(key, d.bytes, d.password)),
      );
      const result = await client.open(source.bytes, source.password);
      if (result.status !== 'ok') throw new Error('Could not reopen the document');
      await exclusive(sync);
      bumpPages('all');
      get().showToast('The PDF engine restarted. No edits were lost.');
    } catch (e) {
      set({ status: 'error', error: `The PDF engine crashed: ${messageOf(e)}` });
    }
  };

  const openBytes = async (password?: string) => {
    const file = pending;
    if (!file) return;
    const hadDocument = source !== null;
    set({ status: 'loading', error: null });
    const result = await engineOrThrow().open(file.bytes, password);
    if (pending !== file) return; // Superseded by another open, or cancelled.
    switch (result.status) {
      case 'ok':
        source = { ...file, password };
        pending = null;
        history.reset();
        useTools.getState().clearRedactMarks();
        ocrCancelled = true; // a run for the previous document stops
        {
          // Images placed in the previous document are no longer needed; session signatures are.
          const keep = useTools.getState().signatures.map((s) => s.key);
          for (const key of images.keys()) if (!keep.includes(key)) images.delete(key);
          void engineOrThrow().retainImages(keep);
          // PDFs inserted into the previous document aren't needed any more.
          documents.clear();
          void engineOrThrow().retainDocuments([]);
        }
        set({
          status: 'ready',
          fileName: file.name,
          renamed: false,
          hasForm: result.hasForm,
          isProtected: password !== undefined,
          docId: get().docId + 1,
          pages: result.pages,
          pageVersions: result.pages.map(() => 0),
          currentPage: 0,
          scrollRequest: { page: 0 },
          passwordError: false,
          search: EMPTY_SEARCH,
          ...historyFlags(),
        });
        if (result.repaired) get().showToast('This PDF was damaged and has been repaired.');
        return;
      case 'needs-password':
        set({ status: 'password', passwordError: false });
        return;
      case 'wrong-password':
        set({ status: 'password', passwordError: true });
        return;
      case 'error': {
        pending = null;
        const error = `"${file.name}" could not be opened as a PDF. (${result.message})`;
        // The engine keeps the previous document open, so keep showing it.
        if (hadDocument) {
          set({ status: 'ready' });
          get().showToast(error);
        } else {
          set({ status: 'error', error });
        }
        return;
      }
    }
  };

  return {
    engineReady: false,
    fontsReady: false,
    status: 'empty',
    error: null,
    passwordError: false,
    fileName: '',
    renamed: false,
    hasForm: false,
    insertPassword: null,
    isProtected: false,
    ocr: null,
    exportingWord: false,
    docId: 0,
    pages: [],
    pageVersions: [],
    zoom: 1,
    zoomMode: 'fit-width',
    currentPage: 0,
    scrollRequest: null,
    canUndo: false,
    canRedo: false,
    dirty: false,
    search: EMPTY_SEARCH,
    objects: [],
    revision: 0,
    toast: null,

    initEngine() {
      if (!engine) startEngine();
    },

    async openFile(file) {
      if (file.size > LARGE_FILE_BYTES) {
        get().showToast('This file is over 200 MB. It may be slow or run out of memory.');
      }
      pending = { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name };
      try {
        await exclusive(() => openBytes());
      } catch (e) {
        pending = null;
        set({ status: source ? 'ready' : 'error', error: source ? null : messageOf(e) });
        if (source) get().showToast(messageOf(e));
      }
    },

    async submitPassword(password) {
      try {
        await exclusive(() => openBytes(password));
      } catch (e) {
        pending = null;
        set({ status: source ? 'ready' : 'error', error: source ? null : messageOf(e) });
      }
    },

    cancelPassword() {
      pending = null;
      set({ status: source ? 'ready' : 'empty', passwordError: false });
    },

    settled() {
      return exclusive(async () => undefined);
    },

    async commit(op) {
      // Text and OCR layers draw with the bundled fonts.
      if (op.kind.startsWith('text.') || op.kind === 'ocr.addLayer')
        await fontsRegistered.catch(() => undefined);
      return exclusive(async () => {
        history.push(op);
        try {
          await sync();
          if (op.kind.startsWith('page.')) afterPageChange();
          return true;
        } catch (e) {
          history.rejectLast();
          set(historyFlags());
          get().showToast(`That change could not be applied: ${messageOf(e)}`);
          return false;
        }
      });
    },

    async insertDocument(file, at, password) {
      // One insert at a time: a second Enter in the password dialog must not insert twice.
      if (inserting) return;
      inserting = true;
      try {
        await insertOne(file, at, password);
      } catch (e) {
        pendingInsert = null;
        set({ insertPassword: null });
        get().showToast(`The pages could not be inserted: ${messageOf(e)}`);
      } finally {
        inserting = false;
      }
    },

    submitInsertPassword(password) {
      if (pendingInsert) void get().insertDocument(pendingInsert.file, pendingInsert.at, password);
    },

    cancelInsertPassword() {
      pendingInsert = null;
      set({ insertPassword: null });
    },

    async recognizePages(which) {
      if (get().ocr) return; // one run at a time
      set({ ocr: { page: -1, progress: 0 } });
      ocrCancelled = false;
      const docId = get().docId;
      let revision = get().revision;
      // The run stops if the document changes underneath it (another file, page edits, undo):
      // its page numbers and rendered geometry would no longer be right.
      const unchanged = () => get().docId === docId && get().revision === revision;
      let done = 0;
      try {
        let pages = which;
        if (pages === 'scanned') {
          pages = [];
          for (let i = 0; i < get().pages.length; i++) {
            if ((await get().getTextRuns(i)).length === 0 && (await get().pageHasImages(i)))
              pages.push(i);
          }
        }
        for (const page of pages) {
          if (ocrCancelled) break;
          if (!unchanged()) {
            get().showToast('Text recognition stopped because the document changed.');
            return;
          }
          set({ ocr: { page, progress: 0 } });
          const info = get().pages[page]!;
          // 300 dpi, capped so huge pages stay within canvas limits.
          const scale = Math.min(300 / 72, Math.sqrt(25_000_000 / (info.width * info.height)));
          const bitmap = await engineOrThrow().render(page, scale);
          let words;
          try {
            words = await recognize(bitmap, scale, (progress) => set({ ocr: { page, progress } }));
          } finally {
            bitmap.close();
          }
          if (ocrCancelled) break;
          if (!unchanged()) {
            get().showToast('Text recognition stopped because the document changed.');
            return;
          }
          if (words.length) {
            if (!(await get().commit({ kind: 'ocr.addLayer', id: newId(), page, words }))) return;
            revision = get().revision;
          }
          done++;
        }
        if (ocrCancelled)
          get().showToast(`Text recognition cancelled after ${done} page${done === 1 ? '' : 's'}.`);
        else if (done === 0) get().showToast('No scanned pages to recognise.');
        else
          get().showToast(
            done === 1
              ? 'Text recognised. You can now search and select it.'
              : `Text recognised on ${done} pages.`,
          );
      } catch (e) {
        get().showToast(`Text recognition failed: ${messageOf(e)}`);
      } finally {
        set({ ocr: null });
      }
    },

    cancelOcr() {
      ocrCancelled = true;
    },

    pageHasImages(page) {
      return engineOrThrow().hasImages(page);
    },

    async exportWord() {
      if (get().exportingWord || !source) return;
      set({ exportingWord: true });
      try {
        const model = await exclusive(() => engineOrThrow().documentModel());
        const blob = await buildDocx(model);
        saveFile(blob, `${baseName(get().fileName)}.docx`);
      } catch (e) {
        get().showToast(`The Word file could not be created: ${messageOf(e)}`);
      } finally {
        set({ exportingWord: false });
      }
    },

    compress(dpi) {
      return exclusive(() => engineOrThrow().compress({ dpi }));
    },

    renameFile(name) {
      const fileName = renamedFileName(name);
      if (fileName && fileName !== get().fileName) set({ fileName, renamed: true });
    },

    saveExport(bytes) {
      saveFile(bytes, downloadFileName(get().fileName, get().renamed));
    },

    applyRedactions(marks) {
      const byPage = new Map<number, Rect[]>();
      for (const m of marks) byPage.set(m.page, [...(byPage.get(m.page) ?? []), m.rect]);
      // One op for every page: a single undo step, and a download can't slip in between pages
      // and save a half-redacted file.
      const op: Op = {
        kind: 'redact',
        areas: [...byPage].map(([page, rects]) => ({ page, rects })),
      };
      return exclusive(async () => {
        history.push(op);
        try {
          await sync();
          useTools.getState().clearRedactMarks();
        } catch (e) {
          history.rejectLast();
          set(historyFlags());
          get().showToast(`The redactions could not be applied: ${messageOf(e)}`);
        }
      });
    },

    async extractPages(pages) {
      if (!pages.length) return;
      const sorted = [...pages].sort((a, b) => a - b);
      try {
        const bytes = await engineOrThrow().extract(sorted);
        saveFile(bytes, `${baseName(get().fileName)}-pages-${pageLabel(sorted)}.pdf`);
      } catch (e) {
        get().showToast(`The pages could not be extracted: ${messageOf(e)}`);
      }
    },

    async split(ranges) {
      try {
        for (const [first, last] of ranges) {
          const bytes = await engineOrThrow().extract(range(first, last));
          saveFile(bytes, `${baseName(get().fileName)}-pages-${first + 1}-${last + 1}.pdf`);
          // Some browsers drop downloads triggered too quickly in a row.
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (e) {
        get().showToast(`The document could not be split: ${messageOf(e)}`);
        throw e;
      }
    },

    async updateObject(id, fn) {
      await fontsRegistered.catch(() => undefined);
      return exclusive(async () => {
        const current = foldObjects(history.active).get(id);
        if (!current) return;
        const next = fn(current);
        if (next && JSON.stringify(next) === JSON.stringify(current)) return;
        history.push(objectOp(next ?? current, next ? 'update' : 'delete'));
        try {
          await sync();
        } catch (e) {
          history.rejectLast();
          set(historyFlags());
          get().showToast(`That change could not be applied: ${messageOf(e)}`);
        }
      });
    },

    undo() {
      return exclusive(async () => {
        if (!history.canUndo) return;
        const undone = history.ops[history.cursor - 1]!;
        history.undo();
        try {
          await sync();
          if (undone.kind.startsWith('page.')) afterPageChange();
        } catch (e) {
          history.redo();
          set(historyFlags());
          get().showToast(`Undo failed: ${messageOf(e)}`);
        }
      });
    },

    redo() {
      return exclusive(async () => {
        if (!history.canRedo) return;
        const redone = history.ops[history.cursor]!;
        history.redo();
        try {
          await sync();
          if (redone.kind.startsWith('page.')) afterPageChange();
        } catch (e) {
          history.undo();
          set(historyFlags());
          get().showToast(`Redo failed: ${messageOf(e)}`);
        }
      });
    },

    download(options = {}) {
      return exclusive(async () => {
        if (!source) return;
        let bytes: Uint8Array;
        try {
          bytes = await engineOrThrow().save(options);
        } catch (e) {
          get().showToast(`The PDF could not be saved: ${messageOf(e)}`);
          return;
        }
        saveFile(bytes, downloadFileName(get().fileName, get().renamed));
        history.markSaved();
        set(historyFlags());
      });
    },

    setZoom(zoom) {
      set({ zoom: clampZoom(zoom), zoomMode: 'custom' });
    },

    setZoomMode(mode) {
      set({ zoomMode: mode });
    },

    applyFit(viewportW, viewportH) {
      const { zoomMode, pages, currentPage } = get();
      const page = pages[currentPage] ?? pages[0];
      if (!page || zoomMode === 'custom') return;
      const zoom =
        zoomMode === 'fit-width'
          ? fitWidth(page.width, viewportW)
          : fitPage(page.width, page.height, viewportW, viewportH);
      if (Math.abs(zoom - get().zoom) > 1e-3) set({ zoom });
    },

    setCurrentPage(page) {
      if (page !== get().currentPage) set({ currentPage: page });
    },

    goToPage(page) {
      const last = get().pages.length - 1;
      if (last < 0) return;
      const target = Math.max(0, Math.min(last, Math.round(page)));
      set({ currentPage: target, scrollRequest: { page: target } });
    },

    clearScrollRequest() {
      set({ scrollRequest: null });
    },

    async runSearch(query) {
      if (get().status !== 'ready' || !query.trim()) {
        set({ search: { ...EMPTY_SEARCH, query } });
        return;
      }
      const hits = await engineOrThrow().search(query);
      const active = hits.length ? 0 : -1;
      set({ search: { query, hits, active, searched: true } });
      const first = hits[0];
      if (first) set({ scrollRequest: { page: first.page, y: first.rects[0]?.y } });
    },

    nextHit() {
      const { search } = get();
      if (!search.hits.length) return;
      const active = (search.active + 1) % search.hits.length;
      const hit = search.hits[active]!;
      set({ search: { ...search, active }, scrollRequest: { page: hit.page, y: hit.rects[0]?.y } });
    },

    prevHit() {
      const { search } = get();
      if (!search.hits.length) return;
      const active = (search.active - 1 + search.hits.length) % search.hits.length;
      const hit = search.hits[active]!;
      set({ search: { ...search, active }, scrollRequest: { page: hit.page, y: hit.rects[0]?.y } });
    },

    clearSearch() {
      set({ search: EMPTY_SEARCH });
    },

    showToast(message) {
      set({ toast: message });
    },

    dismissToast() {
      set({ toast: null });
    },

    getSlots(page) {
      const key = `${get().docId}:${page}:${get().pageVersions[page] ?? 0}`;
      let slots = slotCache.get(key);
      if (!slots) {
        if (slotCache.size > 200) slotCache.clear();
        slots = engineOrThrow().formSlots(page);
        slots.catch(() => slotCache.delete(key));
        slotCache.set(key, slots);
      }
      return slots;
    },

    getTextRuns(page) {
      const key = `${get().docId}:${page}:${get().pageVersions[page] ?? 0}`;
      let runs = textRunCache.get(key);
      if (!runs) {
        if (textRunCache.size > 200) textRunCache.clear();
        runs = engineOrThrow().textRuns(page);
        runs.catch(() => textRunCache.delete(key));
        textRunCache.set(key, runs);
      }
      return runs;
    },

    async addImage(bytes) {
      const key = newId();
      const { width, height } = await engineOrThrow().registerImage(key, bytes);
      images.set(key, bytes);
      return { key, bytes, width, height };
    },

    getTextEditInfo(id) {
      return engineOrThrow().textEditInfo(id);
    },

    getFields(page) {
      return engineOrThrow().fields(page);
    },

    selectText(page, a, b) {
      return engineOrThrow().selectText(page, a, b);
    },

    render(page, scale, signal) {
      return engineOrThrow().render(page, scale, signal);
    },
  };
});

// Phase 1 has no editing tool, so the trivial op is reachable only through this hook, which
// exists only in the build the Playwright suite runs (VITE_E2E=1), never in production.
if (import.meta.env.VITE_E2E) {
  (window as unknown as { __editor: unknown }).__editor = {
    commit: (op: Op) => useEditor.getState().commit(op),
    simulateEngineCrash: () => engine?.simulateCrash(),
  };
}
