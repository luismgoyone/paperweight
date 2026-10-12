import * as mupdf from 'mupdf';
import type { Op, Rect } from '../../shared/types';

// True redaction (spec §6 Phase 6). Covering isn't enough: everything under the area is
// removed from the file. MuPDF's redaction removes text, image pixels and vector graphics;
// annotations and form fields in the area are removed here too (a note or a field value would
// otherwise still carry the hidden information).

const intersects = (a: mupdf.Rect, b: Rect) =>
  a[0] < b.x + b.w && a[2] > b.x && a[1] < b.y + b.h && a[3] > b.y;

export function applyRedactOp(doc: mupdf.PDFDocument, op: Extract<Op, { kind: 'redact' }>): void {
  if (!op.rects.length) throw new Error('Nothing is marked for redaction');
  const page = doc.loadPage(op.page);
  try {
    // Form fields: clear the value, then remove the widget.
    for (const w of page.getWidgets()) {
      if (!op.rects.some((r) => intersects(w.getRect(), r))) continue;
      const field = w.getObject();
      for (const key of ['V', 'DV']) {
        // The value may be on the widget or inherited from its parent field.
        for (
          let node = field, depth = 0;
          !node.isNull() && depth < 32;
          node = node.get('Parent'), depth++
        ) {
          if (!node.get(key).isNull()) node.delete(key);
        }
      }
      page.deleteAnnotation(w);
    }
    for (const a of page.getAnnotations()) {
      if (op.rects.some((r) => intersects(a.getRect(), r))) page.deleteAnnotation(a);
    }
    for (const r of op.rects) {
      const annot = page.createAnnotation('Redact');
      annot.setRect([r.x, r.y, r.x + r.w, r.y + r.h]);
      annot.update();
    }
    page.applyRedactions(
      true,
      mupdf.PDFPage.REDACT_IMAGE_PIXELS,
      mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_TOUCHED,
      mupdf.PDFPage.REDACT_TEXT_REMOVE,
    );
  } finally {
    page.destroy();
  }
}
