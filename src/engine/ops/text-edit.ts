import * as mupdf from 'mupdf';
import type { Op, Rect } from '../../shared/types';
import { runsWithGlyphs, type RunGlyphs } from '../text';
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

/** A point through a matrix (glyph origins are in text space; `ctm` maps them to page space). */
const apply = (m: mupdf.Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

type PageFont = { font: mupdf.Font; glyphs: Map<number, number>; origins: [number, number][] };

/**
 * What the page's own content draws (not annotations or form widgets): every font program with
 * the code point -> glyph id pairs it uses and where its glyphs sit, plus the origins of
 * invisible text (OCR layers, render mode 3).
 */
function pageGlyphs(page: mupdf.PDFPage): { fonts: PageFont[]; invisible: [number, number][] } {
  // Glyph origins are in text space; the device's `ctm` (which includes the page transform)
  // maps them to page space (y down, /Rotate applied), where structured text lives.
  const toPage = (ctm: mupdf.Matrix, trm: mupdf.Matrix) => apply(ctm, trm[4], trm[5]);
  const byPointer = new Map<number, PageFont>();
  const invisible: [number, number][] = [];
  const device = new mupdf.Device({
    fillText(text, ctm) {
      // A ligature is one glyph followed by continuations (glyph -1) for the other characters;
      // it must not become the glyph for its first character.
      let pending: { entry: PageFont; cp: number; gid: number } | null = null;
      const flush = () => {
        if (pending && !pending.entry.glyphs.has(pending.cp))
          pending.entry.glyphs.set(pending.cp, pending.gid);
        pending = null;
      };
      text.walk({
        showGlyph(font, trm, glyph, unicode) {
          const pointer = (font as unknown as { pointer: number }).pointer;
          let entry = byPointer.get(pointer);
          if (!entry) byPointer.set(pointer, (entry = { font, glyphs: new Map(), origins: [] }));
          if (glyph < 0) {
            pending = null; // the previous glyph was a ligature
            return;
          }
          flush();
          entry.origins.push(toPage(ctm, trm));
          if (unicode > 0 && glyph > 0) pending = { entry, cp: unicode, gid: glyph };
        },
        endSpan: flush,
      });
      flush();
    },
    ignoreText(text, ctm) {
      text.walk({
        showGlyph(_font, trm) {
          invisible.push(toPage(ctm, trm));
        },
      });
    },
  });
  try {
    page.runPageContents(device, mupdf.Matrix.identity);
  } finally {
    device.close();
  }
  return { fonts: [...byPointer.values()], invisible };
}

const near = ([x, y]: [number, number], [u, v]: [number, number]) =>
  Math.abs(x - u) < 0.5 && Math.abs(y - v) < 0.5;

/** A fingerprint of every run on the page except `skip`, to prove nothing else changed. */
function otherRuns(runs: RunGlyphs[], skip?: RunGlyphs): string[] {
  const r1 = (n: number) => Math.round(n);
  return runs
    .filter((r) => r !== skip)
    .map((r) => `${r.run.text}|${r.run.font}|${r1(r.run.bbox.x)},${r1(r.run.baseline)}`)
    .sort();
}

type EditOp = Extract<Op, { kind: 'text.edit' }>;

export function applyTextEditOp(doc: mupdf.PDFDocument, op: EditOp): void {
  const before = runsWithGlyphs(doc, op.page);
  const found = before
    .filter((r) => r.run.text === op.target.text)
    .map((r) => ({ r, score: overlap(op.target.bbox, r.run.bbox) }))
    .filter((c) => c.score >= 0.5)
    .sort((a, b) => b.score - a.score)[0]?.r;
  if (!found) throw new Error(`"${op.target.text}" is no longer on this page`);

  // Only horizontal text can be edited in place.
  const [ulx, uly, urx, ury] = found.quads[0]!;
  if (Math.abs(ury - uly) > 0.1 * Math.abs(urx - ulx)) {
    throw new Error("Rotated or vertical text can't be edited in place yet");
  }

  const page = doc.loadPage(op.page);
  try {
    const glyphs = pageGlyphs(page);
    const origins = found.origins.map((o): [number, number] => [o[0], o[1]]);
    if (origins.some((o) => glyphs.invisible.some((i) => near(i, o)))) {
      throw new Error(
        "This text is an invisible layer (for example OCR over a scan), so it can't be edited in place",
      );
    }
    // The run's font program: same name and actually drawing glyphs where the run is.
    const own = glyphs.fonts.find(
      (f) =>
        f.font.getName() === found.run.font &&
        f.origins.some((o) => origins.some((p) => near(o, p))),
    );
    if (own) setOriginalFont(op.id, { name: found.run.font, font: own.font, glyphs: own.glyphs });

    // Prepare first (choose and embed the font, encode the text): if the replacement can't be
    // drawn, the op fails before anything is removed.
    const text = prepareText(doc, page, op.id, op.spec);

    // Remove exactly the run's glyphs: one tiny redaction at each glyph's centre, so lines set
    // closer than their font size (whose glyph boxes overlap ours) aren't touched.
    for (const q of found.quads) {
      const cx = (q[0] + q[2] + q[4] + q[6]) / 4;
      const cy = (q[1] + q[3] + q[5] + q[7]) / 4;
      const redaction = page.createAnnotation('Redact');
      redaction.setRect([cx - 0.25, cy - 0.25, cx + 0.25, cy + 0.25]);
      redaction.update();
    }
    page.applyRedactions(
      false,
      mupdf.PDFPage.REDACT_IMAGE_NONE,
      mupdf.PDFPage.REDACT_LINE_ART_NONE,
      mupdf.PDFPage.REDACT_TEXT_REMOVE,
    );

    // Prove it: every other run on the page is still there, unchanged. If not, the op fails and
    // the document is restored.
    const after = runsWithGlyphs(doc, op.page);
    const expected = otherRuns(before, found);
    const remaining = otherRuns(after);
    const missing = expected.filter((k) => !remaining.includes(k));
    if (
      missing.length ||
      after.some((r) => r.run.text === found.run.text && overlap(found.run.bbox, r.run.bbox) > 0.5)
    ) {
      throw new Error("This text can't be changed in place without affecting text around it");
    }

    text.commit('add');
  } finally {
    page.destroy();
  }
}
