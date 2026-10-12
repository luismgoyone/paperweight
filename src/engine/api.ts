import type {
  FormField,
  Op,
  OpenResult,
  PageInfo,
  Point,
  Quad,
  SearchHit,
  TextRun,
} from '../shared/types';
import type { ChangedPages, SaveOptions } from './document';
import type { RegisterResult } from './documents';
import type { TextEditInfo } from './ops/text-add';

/** The engine's Comlink surface (spec §3.2). Implemented in worker.ts. */
export interface EngineApi {
  open(bytes: Uint8Array, password?: string): Promise<OpenResult>;
  setOps(ops: Op[]): Promise<{ changedPages: ChangedPages; pages: PageInfo[]; hasForm: boolean }>;
  render(page: number, scale: number): Promise<ImageBitmap>;
  search(needle: string): Promise<SearchHit[]>;
  textRuns(page: number): Promise<TextRun[]>;
  hasImages(page: number): Promise<boolean>;
  fields(page: number): Promise<FormField[]>;
  selectText(page: number, a: Point, b: Point): Promise<Quad[]>;
  save(options?: SaveOptions): Promise<Uint8Array>;
  close(): Promise<void>;
  /** Makes an image available to image ops under `key`; returns its pixel size. Idempotent. */
  registerImage(key: string, bytes: Uint8Array): Promise<{ width: number; height: number }>;
  /** Makes another PDF available to `page.insertFrom` under `key`. */
  registerDocument(key: string, bytes: Uint8Array, password?: string): Promise<RegisterResult>;
  /** Which font an edited text object is drawn in (for the substitution notice, spec §4). */
  textEditInfo(id: string): Promise<TextEditInfo | null>;
  /** A smaller copy of the current document (spec §6 Phase 6); the document is unchanged. */
  compress(options: { dpi: number }): Promise<{ bytes: Uint8Array; before: number; after: number }>;
  /** Forgets registered documents except these keys. */
  retainDocuments(keys: string[]): Promise<void>;
  /** A new PDF of these pages of the current document (extract / split). */
  extract(pages: number[]): Promise<Uint8Array>;
  /** Forgets registered images except these keys. */
  retainImages(keys: string[]): Promise<void>;
  /** Makes a bundled font available to text ops. Idempotent. */
  registerFont(id: string, bytes: Uint8Array): Promise<void>;
}

/** Posted by the worker once MuPDF's WASM has loaded and the API is exposed. */
export const ENGINE_READY = 'engine-ready';

/** E2E builds only: asks the worker to throw an uncaught error, like a real crash. */
export const E2E_CRASH = 'e2e-crash';

/** Error name used when the live document can no longer be trusted (failed restore). */
export const ENGINE_BROKEN = 'EngineBroken';

const CRASH_MESSAGE =
  /unreachable|out of memory|\bOOM\b|memory access out of bounds|^Aborted|allocation failed/i;

/**
 * Whether an error from the engine means the WASM instance is dead or corrupt, so the worker
 * must be restarted (spec §7). Ordinary failures (bad op, bad page number) are not crashes.
 */
export function isCrashError(e: unknown): boolean {
  if (!(e instanceof Error) && !(typeof e === 'object' && e !== null && 'message' in e))
    return false;
  const { name = '', message = '' } = e as { name?: string; message?: string };
  if (name === 'OpError') return false;
  return name === 'RuntimeError' || name === ENGINE_BROKEN || CRASH_MESSAGE.test(String(message));
}
