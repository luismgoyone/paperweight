import * as Comlink from 'comlink';
import { ENGINE_READY, type EngineApi } from '../engine/api';
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

export type EngineClient = EngineApi & {
  /** Resolves once MuPDF's WASM has loaded in the worker. */
  ready: Promise<void>;
  terminate(): void;
  /** Called if the worker dies unexpectedly (spec §7). */
  onCrash(listener: (error: unknown) => void): void;
};

export function createEngineClient(): EngineClient {
  const worker = new Worker(new URL('../engine/worker.ts', import.meta.url), {
    type: 'module',
    name: 'pdf-engine',
  });
  const ready = new Promise<void>((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      if (e.data !== ENGINE_READY) return;
      worker.removeEventListener('message', onMessage);
      resolve();
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', (e) => reject(e.error ?? new Error(e.message)), {
      once: true,
    });
  });
  const remote = Comlink.wrap<EngineApi>(worker);
  const enqueue = createSerialQueue();
  const call: Enqueue = (task) => enqueue(() => ready.then(task));

  return {
    ready,
    // Bytes are copied, not transferred: the UI keeps the original to restart a crashed worker.
    open: (bytes, password) => call(() => remote.open(bytes, password) as Promise<OpenResult>),
    setOps: (ops) => call(() => remote.setOps(ops)),
    render: (page, scale) => call(() => remote.render(page, scale)),
    search: (needle) => call(() => remote.search(needle)),
    save: () => call(() => remote.save()),
    close: () => call(() => remote.close()),
    terminate: () => {
      remote[Comlink.releaseProxy]();
      worker.terminate();
    },
    onCrash: (listener) => {
      worker.addEventListener('error', (e) => listener(e.error ?? new Error(e.message)));
      worker.addEventListener('messageerror', (e) => listener(e));
    },
  };
}
