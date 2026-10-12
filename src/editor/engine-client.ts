import * as Comlink from 'comlink';
import { E2E_CRASH, ENGINE_READY, isCrashError, type EngineApi } from '../engine/api';
import type { RegisterResult } from '../engine/documents';
import type { OpenResult } from '../shared/types';

export type Enqueue = <T>(task: () => Promise<T>) => Promise<T>;

/** Runs async tasks strictly one after another, so ops, renders and saves never interleave. */
export function createSerialQueue(): Enqueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

export type EngineClient = Omit<EngineApi, 'render'> & {
  /** Queued renders whose signal is aborted before they start are skipped. */
  render(page: number, scale: number, signal?: AbortSignal): Promise<ImageBitmap>;
  /** Resolves once MuPDF's WASM has loaded in the worker. */
  ready: Promise<void>;
  terminate(): void;
  /** Called at most once if the engine dies after loading (spec §7). */
  onCrash(listener: (error: unknown) => void): void;
  /** Test-only: makes the worker throw an uncaught error (E2E builds only). */
  simulateCrash(): void;
};

export function createEngineClient(): EngineClient {
  const worker = new Worker(new URL('../engine/worker.ts', import.meta.url), {
    type: 'module',
    name: 'pdf-engine',
  });

  let loaded = false;
  let crashed = false;
  const crashListeners: ((error: unknown) => void)[] = [];
  const crash = (error: unknown) => {
    // A load failure is reported through `ready`, not as a crash, so it can't restart-loop.
    if (!loaded || crashed) return;
    crashed = true;
    crashListeners.forEach((l) => l(error));
  };

  const ready = new Promise<void>((resolve, reject) => {
    worker.addEventListener('message', (e: MessageEvent) => {
      if (e.data !== ENGINE_READY) return;
      loaded = true;
      resolve();
    });
    worker.addEventListener('error', (e) => {
      const error = e.error ?? new Error(e.message || 'The PDF engine stopped');
      if (loaded) crash(error);
      else reject(error);
    });
    worker.addEventListener('messageerror', (e) => crash(e));
  });

  const remote = Comlink.wrap<EngineApi>(worker);
  const enqueue = createSerialQueue();
  const call: Enqueue = (task) =>
    enqueue(() => ready.then(task)).catch((e: unknown) => {
      if (isCrashError(e)) crash(e);
      throw e;
    });

  return {
    ready,
    // Bytes are copied, not transferred: the UI keeps the original to restart a crashed worker.
    open: (bytes, password) => call(() => remote.open(bytes, password) as Promise<OpenResult>),
    setOps: (ops) => call(() => remote.setOps(ops)),
    render: (page, scale, signal) =>
      call(() =>
        signal?.aborted ? Promise.reject(new CancelledError()) : remote.render(page, scale),
      ),
    search: (needle) => call(() => remote.search(needle)),
    textRuns: (page) => call(() => remote.textRuns(page)),
    fields: (page) => call(() => remote.fields(page)),
    selectText: (page, a, b) => call(() => remote.selectText(page, a, b)),
    save: (options) => call(() => remote.save(options)),
    close: () => call(() => remote.close()),
    registerFont: (id, bytes) => call(() => remote.registerFont(id, bytes)),
    registerImage: (key, bytes) => call(() => remote.registerImage(key, bytes)),
    retainImages: (keys) => call(() => remote.retainImages(keys)),
    registerDocument: (key, bytes, password) =>
      call(() => remote.registerDocument(key, bytes, password) as Promise<RegisterResult>),
    extract: (pages) => call(() => remote.extract(pages)),
    retainDocuments: (keys) => call(() => remote.retainDocuments(keys)),
    textEditInfo: (id) => call(() => remote.textEditInfo(id)),
    terminate: () => {
      crashed = true;
      remote[Comlink.releaseProxy]();
      worker.terminate();
    },
    onCrash: (listener) => {
      crashListeners.push(listener);
    },
    simulateCrash: () => worker.postMessage(E2E_CRASH),
  };
}
