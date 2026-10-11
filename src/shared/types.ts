// Types shared by the engine worker and the UI thread. No runtime dependencies.

/** A rectangle in PDF points, MuPDF page space (origin top-left, y grows downward). */
export type Rect = { x: number; y: number; w: number; h: number };

export type PageInfo = { index: number; width: number; height: number };

export type SearchHit = { page: number; rects: Rect[] };

export type OpenResult =
  | { status: 'ok'; pages: PageInfo[]; repaired: boolean }
  | { status: 'needs-password' }
  | { status: 'wrong-password' }
  | { status: 'error'; message: string };

/**
 * Everything that changes the document is an Op (spec §3.3).
 * Phase 1 only has a trivial op that exercises the op log; later phases extend this union.
 */
export type Op = { kind: 'meta.setTitle'; title: string };

/** Ops that get a checkpoint taken before them (redact, page delete; spec §3.3). */
export const DESTRUCTIVE_KINDS: ReadonlySet<Op['kind']> = new Set<Op['kind']>([]);
