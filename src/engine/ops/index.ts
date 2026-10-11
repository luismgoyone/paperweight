import type * as mupdf from 'mupdf';
import type { Op } from '../../shared/types';
import { applySetTitle } from './meta';

/** An op could not be applied; the document stays at its prior state (spec §7). */
export class OpError extends Error {
  constructor(
    message: string,
    readonly op: Op,
  ) {
    super(message);
    this.name = 'OpError';
  }
}

export function applyOp(doc: mupdf.PDFDocument, op: Op): void {
  try {
    switch (op.kind) {
      case 'meta.setTitle':
        return applySetTitle(doc, op);
      default:
        throw new Error(`Unknown operation "${(op as { kind: string }).kind}"`);
    }
  } catch (e) {
    if (e instanceof OpError) throw e;
    throw new OpError(e instanceof Error ? e.message : String(e), op);
  }
}

/** Pages whose rendering an op changes. Document-level ops change none. */
export function pagesTouched(op: Op): number[] {
  return 'page' in op ? [op.page] : [];
}
