import type { Op, OpenResult, PageInfo, SearchHit } from '../shared/types';
import type { ChangedPages } from './document';

/** The engine's Comlink surface (spec §3.2). Implemented in worker.ts. */
export interface EngineApi {
  open(bytes: Uint8Array, password?: string): Promise<OpenResult>;
  setOps(ops: Op[]): Promise<{ changedPages: ChangedPages; pages: PageInfo[] }>;
  render(page: number, scale: number): Promise<ImageBitmap>;
  search(needle: string): Promise<SearchHit[]>;
  save(): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** Posted by the worker once MuPDF's WASM has loaded and the API is exposed. */
export const ENGINE_READY = 'engine-ready';
