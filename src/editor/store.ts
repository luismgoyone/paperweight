import { create } from 'zustand';
import { editedFileName } from '../shared/filename';
import type { Op, PageInfo, SearchHit } from '../shared/types';
import { createEngineClient, type EngineClient } from './engine-client';
import { History } from './history';
import { clampZoom, fitPage, fitWidth, type ZoomMode } from './zoom';

export const LARGE_FILE_BYTES = 200 * 1024 * 1024;

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
  toast: string | null;

  initEngine(): void;
  /** Restarts the worker and replays the op log (what a crash triggers; spec §7). */
  restartEngine(): Promise<void>;
  openFile(file: File): Promise<void>;
  submitPassword(password: string): Promise<void>;
  cancelPassword(): void;
  commit(op: Op): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  download(): Promise<void>;
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
  render(page: number, scale: number): Promise<ImageBitmap>;
};

const EMPTY_SEARCH: SearchState = { query: '', hits: [], active: -1, searched: false };

// Non-reactive session state: the engine handle, the op log and the open file's bytes.
// All of it lives in memory only and is dropped with the tab (spec §2).
let engine: EngineClient | null = null;
const history = new History();
let source: { bytes: Uint8Array; name: string; password?: string } | null = null;

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
  });

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

  const startEngine = () => {
    const client = createEngineClient();
    engine = client;
    set({ engineReady: false });
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
    const client = startEngine();
    if (!source) return;
    try {
      const result = await client.open(source.bytes, source.password);
      if (result.status !== 'ok') throw new Error('Could not reopen the document');
      await sync();
      bumpPages('all');
      get().showToast('The PDF engine restarted. No edits were lost.');
    } catch (e) {
      set({ status: 'error', error: `The PDF engine crashed: ${messageOf(e)}` });
    }
  };

  const openBytes = async (password?: string) => {
    if (!source) return;
    set({ status: 'loading', error: null });
    const result = await engineOrThrow().open(source.bytes, password);
    switch (result.status) {
      case 'ok':
        source.password = password;
        history.reset();
        set({
          status: 'ready',
          fileName: source.name,
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
      case 'error':
        set({
          status: 'error',
          error: `This file could not be opened as a PDF. (${result.message})`,
        });
        return;
    }
  };

  return {
    engineReady: false,
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
    toast: null,

    initEngine() {
      if (!engine) startEngine();
    },

    async restartEngine() {
      if (engine) await recover(engine);
    },

    async openFile(file) {
      if (file.size > LARGE_FILE_BYTES) {
        get().showToast('This file is over 200 MB. It may be slow or run out of memory.');
      }
      source = { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name };
      try {
        await openBytes();
      } catch (e) {
        set({ status: 'error', error: messageOf(e) });
      }
    },

    async submitPassword(password) {
      try {
        await openBytes(password);
      } catch (e) {
        set({ status: 'error', error: messageOf(e) });
      }
    },

    cancelPassword() {
      source = null;
      set({ status: get().pages.length ? 'ready' : 'empty', passwordError: false });
    },

    async commit(op) {
      history.push(op);
      try {
        await sync();
      } catch (e) {
        history.rejectLast();
        set(historyFlags());
        get().showToast(`That change could not be applied: ${messageOf(e)}`);
      }
    },

    async undo() {
      if (!history.canUndo) return;
      history.undo();
      await sync();
    },

    async redo() {
      if (!history.canRedo) return;
      history.redo();
      await sync();
    },

    async download() {
      if (get().status !== 'ready') return;
      const bytes = await engineOrThrow().save();
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = editedFileName(get().fileName);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      history.markSaved();
      set(historyFlags());
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

    render(page, scale) {
      return engineOrThrow().render(page, scale);
    },
  };
});

// Phase 1 has no editing tool, so the trivial op is reachable only through this hook,
// which the e2e tests use (`/#e2e`). It exposes nothing the UI couldn't already do.
if (import.meta.env.MODE !== 'production' || window.location.hash === '#e2e') {
  (window as unknown as { __editor: unknown }).__editor = {
    commit: (op: Op) => useEditor.getState().commit(op),
    simulateEngineCrash: () => useEditor.getState().restartEngine(),
  };
}
