import type * as mupdf from 'mupdf';
import type { Op } from '../../shared/types';

/** Trivial Phase 1 op: sets the document title. Exercises the op log end to end. */
export function applySetTitle(doc: mupdf.PDFDocument, op: Extract<Op, { kind: 'meta.setTitle' }>) {
  doc.setMetaData('info:Title', op.title);
}
