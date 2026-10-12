import type * as mupdf from 'mupdf';
import type { Op } from '../../shared/types';
import { applyAnnotOp } from './annotations';
import { applyFormSet } from '../forms';
import { applyImageOp } from './images';
import { applySetTitle } from './meta';
import { applyPageOp } from './pages';
import { applyRedactOp } from './redact';
import { applyTextOp } from './text-add';
import { applyTextEditOp } from './text-edit';

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
      case 'annot.add':
      case 'annot.update':
      case 'annot.delete':
        return applyAnnotOp(doc, op);
      case 'text.add':
      case 'text.update':
      case 'text.delete':
        return applyTextOp(doc, op);
      case 'text.edit':
        return applyTextEditOp(doc, op);
      case 'image.add':
      case 'image.update':
      case 'image.delete':
        return applyImageOp(doc, op);
      case 'form.set':
        return applyFormSet(doc, op);
      case 'page.move':
      case 'page.rotate':
      case 'page.delete':
      case 'page.insertBlank':
      case 'page.insertFrom':
        return applyPageOp(doc, op);
      case 'redact':
        return applyRedactOp(doc, op);
      default:
        throw new Error(`Unknown operation "${(op as { kind: string }).kind}"`);
    }
  } catch (e) {
    if (e instanceof OpError) throw e;
    throw new OpError(e instanceof Error ? e.message : String(e), op);
  }
}

/** Pages whose rendering an op changes. Document-level ops change none. */
/** Pages whose rendering an op changes, or 'all' when the op isn't tied to one page. */
export function pagesTouched(op: Op): number[] | 'all' {
  if ('page' in op) return [op.page];
  return op.kind === 'form.set' || op.kind.startsWith('page.') ? 'all' : [];
}
