import * as mupdf from 'mupdf';
import { graftPageWithAnnots } from './graft';

/** A new PDF containing `pages` of `doc` (in that order). The open document is unchanged. */
export function extractPages(doc: mupdf.PDFDocument, pages: number[]): Uint8Array {
  const out = new mupdf.PDFDocument();
  try {
    const map = out.newGraftMap();
    pages.forEach((p, i) => graftPageWithAnnots(out, map, i, doc, p));
    const buffer = out.saveToBuffer('garbage,compress');
    try {
      return buffer.asUint8Array().slice();
    } finally {
      buffer.destroy();
    }
  } finally {
    out.destroy();
  }
}
