import * as mupdf from 'mupdf';
import type { Slot } from '../shared/types';

// Blank boxes on flat forms (forms without fields: printed, scanned, or re-saved from Word).
// The rendered page is used rather than the drawing commands: Word draws table borders as
// thousands of hairline rectangles and never draws a blank cell at all, while every form,
// however it was made, shows its blanks as white areas enclosed by lines. So: render in grey,
// flood-fill the near-white pixels, and keep the enclosed regions that are box-shaped.
// Text inside a region isn't judged here; the editor knows which text the user added.

const SCALE = 2; // pixels per point
const WHITE = 235; // grey level above which a pixel counts as blank (grey label cells are ~217)
const MIN_SIDE = 6; // points
const MIN_FILL = 0.6; // share of the bounding box the region must cover
const MAX_CHECK = 20; // points
const CHECK_ASPECT = [0.6, 1.6];

export function findSlots(doc: mupdf.Document, pageIndex: number): Slot[] {
  const page = doc.loadPage(pageIndex);
  let pix: mupdf.Pixmap | null = null;
  try {
    const [bx, by] = page.getBounds();
    // The holes inside letters ("o", "P", "8") are enclosed white areas too.
    const glyphs: mupdf.Rect[] = [];
    const stext = page.toStructuredText('');
    try {
      stext.walk({
        onChar(c, _origin, _font, _size, q) {
          if (c.trim())
            glyphs.push([
              Math.min(q[0], q[4]),
              Math.min(q[1], q[3]),
              Math.max(q[2], q[6]),
              Math.max(q[5], q[7]),
            ]);
        },
      });
    } finally {
      stext.destroy();
    }
    // Annotations are left out: highlights or notes don't change where the boxes are.
    pix = page.toPixmap(
      mupdf.Matrix.scale(SCALE, SCALE),
      mupdf.ColorSpace.DeviceGray,
      false,
      false,
    );
    const w = pix.getWidth();
    const h = pix.getHeight();
    const pixels = pix.getPixels();
    const n = w * h;
    const label = new Int32Array(n); // 0 = unvisited, -1 = ink
    for (let i = 0; i < n; i++) if (pixels[i]! <= WHITE) label[i] = -1;
    const stack = new Int32Array(n);
    const slots: Slot[] = [];
    let id = 0;
    for (let start = 0; start < n; start++) {
      if (label[start] !== 0) continue;
      id++;
      let top = 0;
      stack[top++] = start;
      label[start] = id;
      let count = 0;
      let x0 = w;
      let y0 = h;
      let x1 = 0;
      let y1 = 0;
      let edge = false;
      while (top) {
        const i = stack[--top]!;
        count++;
        const x = i % w;
        const y = (i - x) / w;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
        const visit = (j: number) => {
          if (label[j] !== 0) return;
          label[j] = id;
          stack[top++] = j;
        };
        if (x > 0) visit(i - 1);
        if (x < w - 1) visit(i + 1);
        if (y > 0) visit(i - w);
        if (y < h - 1) visit(i + w);
      }
      // Touching the page edge: the margin around the form, not a box.
      if (edge) continue;
      const pw = x1 - x0 + 1;
      const ph = y1 - y0 + 1;
      if (count / (pw * ph) < MIN_FILL) continue;
      const rect = { x: bx + x0 / SCALE, y: by + y0 / SCALE, w: pw / SCALE, h: ph / SCALE };
      if (rect.w < MIN_SIDE || rect.h < MIN_SIDE) continue;
      const inGlyph = glyphs.some(
        (g) =>
          rect.x >= g[0] - 1 &&
          rect.y >= g[1] - 1 &&
          rect.x + rect.w <= g[2] + 1 &&
          rect.y + rect.h <= g[3] + 1,
      );
      if (inGlyph) continue;
      const aspect = rect.w / rect.h;
      const check =
        rect.w <= MAX_CHECK &&
        rect.h <= MAX_CHECK &&
        aspect >= CHECK_ASPECT[0]! &&
        aspect <= CHECK_ASPECT[1]!;
      slots.push({ kind: check ? 'check' : 'text', rect });
    }
    return slots;
  } finally {
    pix?.destroy();
    page.destroy();
  }
}
