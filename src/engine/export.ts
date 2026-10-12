import * as mupdf from 'mupdf';
import { graftPages } from './graft';

/** A new PDF containing `pages` of `doc` (in that order). The open document is unchanged. */
export function extractPages(doc: mupdf.PDFDocument, pages: number[]): Uint8Array {
  const out = new mupdf.PDFDocument();
  try {
    graftPages(out, 0, doc, pages);
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
