import * as mupdf from 'mupdf';
import type { Op, Rect } from '../../shared/types';

// True redaction (spec §6 Phase 6). Covering isn't enough: everything under the area is
// removed from the file. MuPDF's redaction removes text, image pixels and vector graphics;
// annotations and form fields in the area are removed here too (a note or a field value would
// otherwise still carry the hidden information), and so is replacement text for assistive
// technology (/ActualText, /Alt, /E), which repeats the visible words in tagged PDFs.

const intersects = (a: mupdf.Rect, b: Rect) =>
  a[0] < b.x + b.w && a[2] > b.x && a[1] < b.y + b.h && a[3] > b.y;

const REPLACEMENT_KEYS = ['ActualText', 'Alt', 'E'];

/** Removes /ActualText, /Alt and /E from inline marked-content property lists in content. */
export function stripReplacementText(content: string): string {
  const value = String.raw`\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>`;
  const key = new RegExp(String.raw`/(?:${REPLACEMENT_KEYS.join('|')})\s*(?:${value})`, 'g');
  return content.replace(
    new RegExp(String.raw`<<((?:[^<>]|<[0-9A-Fa-f\s]*>)*)>>(\s*BDC)`, 'g'),
    (_m, inner: string, bdc: string) => `<<${inner.replace(key, '')}>>${bdc}`,
  );
}

function stripPage(doc: mupdf.PDFDocument, pageObj: mupdf.PDFObject): void {
  // Inline property lists in the page content.
  const contents = pageObj.get('Contents');
  const streams: mupdf.PDFObject[] = [];
  const resolved = contents.isNull() ? contents : contents.resolve();
  if (resolved.isArray()) for (let i = 0; i < resolved.length; i++) streams.push(resolved.get(i));
  else if (!contents.isNull()) streams.push(contents);
  const rewritten = streams.map((stream) => {
    const buffer = stream.readStream();
    const text = buffer.asString();
    buffer.destroy();
    const stripped = stripReplacementText(text);
    return stripped === text ? stream : doc.addStream(stripped, {});
  });
  if (rewritten.length === 1) {
    pageObj.put('Contents', rewritten[0]!);
  } else if (rewritten.length > 1) {
    const own = doc.newArray();
    for (const r of rewritten) own.push(r);
    pageObj.put('Contents', own);
  }

  // Named property lists in /Resources/Properties.
  const properties = pageObj.get('Resources', 'Properties');
  if (properties.isDictionary()) {
    properties.forEach((dict) => {
      const d = dict.resolve();
      if (d.isDictionary()) for (const k of REPLACEMENT_KEYS) d.delete(k);
    });
  }

  // Structure elements that belong to this page.
  const root = doc.getTrailer().get('Root', 'StructTreeRoot');
  if (!root.isDictionary()) return;
  const pageNum = pageObj.isIndirect() ? pageObj.asIndirect() : -1;
  const visit = (node: mupdf.PDFObject, inheritedPage: number, depth: number) => {
    if (depth > 64) return;
    const el = node.resolve();
    if (el.isArray()) {
      for (let i = 0; i < el.length; i++) visit(el.get(i), inheritedPage, depth + 1);
      return;
    }
    if (!el.isDictionary()) return;
    const pg = el.get('Pg');
    const onPage = pg.isIndirect() ? pg.asIndirect() : inheritedPage;
    if (onPage === pageNum) for (const k of REPLACEMENT_KEYS) el.delete(k);
    const kids = el.get('K');
    if (!kids.isNull()) visit(kids, onPage, depth + 1);
  };
  visit(root.get('K'), -1, 0);
}

function redactPage(doc: mupdf.PDFDocument, pageIndex: number, rects: Rect[]): void {
  const page = doc.loadPage(pageIndex);
  try {
    // Form fields: clear the value, then remove the widget.
    for (const w of page.getWidgets()) {
      if (!rects.some((r) => intersects(w.getRect(), r))) continue;
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
      if (rects.some((r) => intersects(a.getRect(), r))) page.deleteAnnotation(a);
    }
    for (const r of rects) {
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
    stripPage(doc, page.getObject());
  } finally {
    page.destroy();
  }
}

export function applyRedactOp(doc: mupdf.PDFDocument, op: Extract<Op, { kind: 'redact' }>): void {
  const areas = op.areas.filter((a) => a.rects.length);
  if (!areas.length) throw new Error('Nothing is marked for redaction');
  for (const area of areas) redactPage(doc, area.page, area.rects);
}
