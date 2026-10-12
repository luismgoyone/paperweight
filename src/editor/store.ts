import { create } from 'zustand';
import { editedFileName } from '../shared/filename';
import type { ImageAsset, Op, PageInfo, Point, Quad, SearchHit, TextRun } from '../shared/types';
import { newId } from './ids';
import { createEngineClient, createSerialQueue, type EngineClient } from './engine-client';
import { loadFonts } from './fonts';
import { History } from './history';
import { foldObjects, type EditorObject } from './objects';
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
  /** Objects added by the user (annotations, text), in drawing order. Derived from the op log. */
  objects: EditorObject[];
  toast: string | null;

  initEngine(): void;
  openFile(file: File): Promise<void>;
  submitPassword(password: string): Promise<void>;
  cancelPassword(): void;
  commit(op: Op): Promise<void>;
  /**
   * Changes an added object based on its latest committed state (`fn` returns the new object,
   * or null to delete it). Runs in order with other edits, so quick successive changes can't
   * overwrite each other with stale copies.
   */
  updateObject(id: string, fn: (o: EditorObject) => EditorObject | null): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  download(options?: { flatten?: boolean }): Promise<void>;
  /** Existing text on a page (cached per page version). */
  getTextRuns(page: number): Promise<TextRun[]>;
  selectText(page: number, a: Point, b: Point): Promise<Quad[]>;
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
/** Resolves when the current engine has every bundled font (text ops need them). */
let fontsRegistered: Promise<void> = Promise.resolve();
// History changes and the engine sync that follows them run one at a time, so a failed op
// is always the last one pushed and a download always saves the state it marks as saved.
const exclusive = createSerialQueue();

function engineOrThrow(): EngineClient {
  if (!engine) throw new Error('The PDF engine is not running');
  return engine;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useEditor = create<EditorState>()((set, get) => {
  const historyFlags = () => ({
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    dirty: history.dirty,
    objects: [...foldObjects(history.active).values()],
  });

  const textRunCache = new Map<string, Promise<TextRun[]>>();

  const bumpPages = (changed: number[] | 'all', pages = get().pages) => {
    const prev = get().pageVersions;
    const versions = pages.map((_, i) => prev[i] ?? 0);
    const targets = changed === 'all' ? versions.map((_, i) => i) : changed;
    for (const i of targets) if (i < versions.length) versions[i] = versions[i]! + 1;
    set({ pages, pageVersions: versions });
  };

  const sync = async () => {
    const { changedPages, pages } = await engineOrThrow().setOps(history.active);
    bumpPages(changedPages, pages);
    set(historyFlags());
  };

  const registerFonts = async (client: EngineClient) => {
    const fonts = await loadFonts();
    await Promise.all([...fonts].map(([id, bytes]) => client.registerFont(id, bytes)));
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
        set({
          status: 'ready',
          fileName: file.name,
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

    async commit(op) {
      if (op.kind.startsWith('text.')) await fontsRegistered.catch(() => undefined);
      return exclusive(async () => {
        history.push(op);
        try {
          await sync();
        } catch (e) {
          history.rejectLast();
          set(historyFlags());
          get().showToast(`That change could not be applied: ${messageOf(e)}`);
        }
      });
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
        history.undo();
        try {
          await sync();
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
        history.redo();
        try {
          await sync();
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
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = editedFileName(get().fileName);
        document.body.append(a);
        a.click();
        a.remove();
        // Revoking immediately can cancel the download in some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
