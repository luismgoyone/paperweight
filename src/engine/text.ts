import * as mupdf from 'mupdf';
import type { Color, Point, Quad, TextRun } from '../shared/types';

type Char = {
  c: string;
  origin: mupdf.Point;
  quad: mupdf.Quad;
  font: string;
  size: number;
  color: Color;
};

function toColor(c: mupdf.Color): Color {
  if (c.length === 3) return [c[0], c[1], c[2]];
  if (c.length === 1) return [c[0], c[0], c[0]];
  // CMYK -> RGB (naive; only used for defaults/snapping).
  const [cy, m, y, k] = c;
  return [(1 - cy) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function charsToRun(chars: Char[]): TextRun | null {
  const visible = chars.filter((ch) => ch.c.trim());
  if (!visible.length) return null;
  const xs = visible.flatMap((ch) => [ch.quad[0], ch.quad[2], ch.quad[4], ch.quad[6]]);
  const ys = visible.flatMap((ch) => [ch.quad[1], ch.quad[3], ch.quad[5], ch.quad[7]]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const first = visible[0]!;
  return {
    text: chars
      .map((ch) => ch.c)
      .join('')
      .trim(),
    bbox: { x: round(x0), y: round(y0), w: round(x1 - x0), h: round(Math.max(...ys) - y0) },
    baseline: round(first.origin[1]),
    x0: round(x0),
    x1: round(x1),
    font: first.font,
    size: round(first.size),
    color: first.color,
  };
}

/**
 * Existing text on a page as runs: one per line segment, split where a gap is wider than
 * 1.5 em so table columns become separate runs. Coordinates are page space (as rendered).
 */
export function textRuns(doc: mupdf.Document, pageIndex: number): TextRun[] {
  return runsWithGlyphs(doc, pageIndex).map((r) => r.run);
}

/** A run plus the quads of its visible characters (for removing exactly those glyphs). */
export type RunGlyphs = { run: TextRun; quads: mupdf.Quad[]; origins: mupdf.Point[] };

export function runsWithGlyphs(doc: mupdf.Document, pageIndex: number): RunGlyphs[] {
  const page = doc.loadPage(pageIndex);
  const stext = page.toStructuredText('preserve-whitespace');
  const runs: RunGlyphs[] = [];
  const push = (segment: Char[]) => {
    const run = charsToRun(segment);
    const visible = segment.filter((ch) => ch.c.trim());
    if (run)
      runs.push({
        run,
        quads: visible.map((ch) => ch.quad),
        origins: visible.map((ch) => ch.origin),
      });
  };
  let line: Char[] = [];
  const flush = () => {
    let segment: Char[] = [];
    let lastRight: number | null = null;
    for (const ch of line) {
      const left = Math.min(ch.quad[0], ch.quad[4]);
      if (lastRight !== null && ch.c.trim() && left - lastRight > ch.size * 1.5) {
        push(segment);
        segment = [];
      }
      segment.push(ch);
      if (ch.c.trim()) lastRight = Math.max(ch.quad[2], ch.quad[6]);
    }
    push(segment);
    line = [];
  };
  try {
    stext.walk({
      onChar(c, origin, font, size, quad, color) {
        line.push({ c, origin, quad, font: font.getName(), size, color: toColor(color) });
      },
      endLine: flush,
    });
  } finally {
    stext.destroy();
    page.destroy();
  }
  return runs;
}

const toQuad = (q: mupdf.Quad): Quad => [
  { x: q[0], y: q[1] },
  { x: q[2], y: q[3] },
  { x: q[4], y: q[5] },
  { x: q[6], y: q[7] },
];

/** Whether a page draws any image (a scan, for example). */
export function hasImages(doc: mupdf.Document, pageIndex: number): boolean {
  const page = doc.loadPage(pageIndex);
  const stext = page.toStructuredText('preserve-images');
  let found = false;
  try {
    stext.walk({
      onImageBlock() {
        found = true;
      },
    });
  } finally {
    stext.destroy();
    page.destroy();
  }
  return found;
}

/** Quads of the text selected by dragging from `a` to `b` (page space). */
export function selectText(doc: mupdf.Document, pageIndex: number, a: Point, b: Point): Quad[] {
  const page = doc.loadPage(pageIndex);
  const stext = page.toStructuredText('preserve-whitespace');
  try {
    return stext.highlight([a.x, a.y], [b.x, b.y], 500).map(toQuad);
  } finally {
    stext.destroy();
    page.destroy();
  }
}
