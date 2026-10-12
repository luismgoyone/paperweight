import * as mupdf from 'mupdf';
import type { Op, Rect } from '../../shared/types';
import { runsWithGlyphs } from '../text';
import { prepareText, setOriginalFont } from './text-add';

export { textEditInfo } from './text-add';

// Editing existing text in place (spec §4, §6 Phase 5): remove exactly the run's glyphs with a
// text-only redaction (no black box; images and vector graphics untouched), then draw the
// replacement as an added-text section, in the run's own font when it has every glyph.

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.max(1e-6, a.w * a.h) : 0;
}

/** Every glyph each font draws on the page: code point -> glyph id, by font name. */
function pageGlyphs(
  page: mupdf.Page,
): Map<string, { font: mupdf.Font; glyphs: Map<number, number> }> {
  const fonts = new Map<string, { font: mupdf.Font; glyphs: Map<number, number> }>();
  const device = new mupdf.Device({
    fillText(text) {
      text.walk({
        showGlyph(font, _trm, glyph, unicode) {
          let entry = fonts.get(font.getName());
          if (!entry) fonts.set(font.getName(), (entry = { font, glyphs: new Map() }));
          if (unicode > 0 && glyph > 0 && !entry.glyphs.has(unicode))
            entry.glyphs.set(unicode, glyph);
        },
      });
    },
  });
  try {
    page.run(device, mupdf.Matrix.identity);
  } finally {
    device.close();
  }
  return fonts;
}

type EditOp = Extract<Op, { kind: 'text.edit' }>;

export function applyTextEditOp(doc: mupdf.PDFDocument, op: EditOp): void {
  const candidates = runsWithGlyphs(doc, op.page)
    .filter((r) => r.run.text === op.target.text)
    .map((r) => ({ ...r, score: overlap(op.target.bbox, r.run.bbox) }))
    .filter((r) => r.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  const found = candidates[0];
  if (!found) throw new Error(`"${op.target.text}" is no longer on this page`);

  // Only horizontal text can be edited in place.
  const [ulx, uly, urx, ury] = found.quads[0]!;
  if (Math.abs(ury - uly) > 0.1 * Math.abs(urx - ulx)) {
    throw new Error("Rotated or vertical text can't be edited in place yet");
  }

  const page = doc.loadPage(op.page);
  try {
    const font = pageGlyphs(page).get(found.run.font);
    if (font)
      setOriginalFont(op.id, { name: found.run.font, font: font.font, glyphs: font.glyphs });

    // Prepare first: if the replacement can't be drawn, nothing has changed yet.
    const text = prepareText(doc, page, op.id, op.spec);

    // Remove exactly the run's glyphs. Insetting the rect keeps neighbouring lines and
    // characters (whose boxes may touch it) out of the redaction.
    const xs = found.quads.flatMap((q) => [q[0], q[2], q[4], q[6]]);
    const ys = found.quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const insetY = (y1 - y0) * 0.2;
    const redaction = page.createAnnotation('Redact');
    redaction.setRect([x0 + 0.2, y0 + insetY, x1 - 0.2, y1 - insetY]);
    redaction.update();
    page.applyRedactions(
      false,
      mupdf.PDFPage.REDACT_IMAGE_NONE,
      mupdf.PDFPage.REDACT_LINE_ART_NONE,
      mupdf.PDFPage.REDACT_TEXT_REMOVE,
    );

    text.commit('add');
  } finally {
    page.destroy();
  }
}
