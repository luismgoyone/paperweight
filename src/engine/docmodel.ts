import * as mupdf from 'mupdf';
import type { Color, DocBlock, DocPage, DocRun } from '../shared/types';

// A structured, best-effort reading of each page for Word export (spec §6 Phase 8):
// paragraphs with their text styles and alignment, images, and simple tables detected from
// column-aligned text. Fidelity is best-effort by design; the UI says so.

type Char = { c: string; quad: mupdf.Quad; size: number; font: string; color: Color };
type Cell = {
  chars: Char[];
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  baseline: number;
  size: number;
};
type Line = {
  cells: Cell[];
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  baseline: number;
  size: number;
};

const EDGE = 2; // points: how close edges must be to count as aligned

function toColor(c: mupdf.Color): Color {
  if (c.length === 3) return [c[0], c[1], c[2]];
  if (c.length === 1) return [c[0], c[0], c[0]];
  const [cy, m, y, k] = c;
  return [(1 - cy) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
}

const isBold = (font: string) => /bold|black|heavy|semibold/i.test(font);
const isItalic = (font: string) => /italic|oblique/i.test(font);

function bounds(chars: Char[]) {
  const vis = chars.filter((ch) => ch.c.trim());
  const xs = vis.flatMap((ch) => [ch.quad[0], ch.quad[2], ch.quad[4], ch.quad[6]]);
  const ys = vis.flatMap((ch) => [ch.quad[1], ch.quad[3], ch.quad[5], ch.quad[7]]);
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

/** Groups characters into runs of the same style. */
function runsOf(chars: Char[]): DocRun[] {
  const runs: DocRun[] = [];
  for (const ch of chars) {
    const style = {
      size: Math.round(ch.size * 2) / 2,
      bold: isBold(ch.font),
      italic: isItalic(ch.font),
      color: ch.color.map((v) => Math.round(v * 100) / 100) as Color,
    };
    const last = runs[runs.length - 1];
    if (
      last &&
      last.size === style.size &&
      last.bold === style.bold &&
      last.italic === style.italic &&
      last.color.every((v, i) => v === style.color[i])
    ) {
      last.text += ch.c;
    } else {
      runs.push({ text: ch.c, ...style });
    }
  }
  return runs;
}

function trimRuns(runs: DocRun[]): DocRun[] {
  const out = runs.map((r) => ({ ...r }));
  if (out[0]) out[0].text = out[0].text.trimStart();
  const last = out[out.length - 1];
  if (last) last.text = last.text.trimEnd();
  return out.filter((r) => r.text);
}

/** Splits a line where a gap is wider than 1.5 em (table columns, tab stops). */
function cellsOf(chars: Char[]): Cell[] {
  const cells: Cell[] = [];
  let current: Char[] = [];
  let lastRight: number | null = null;
  const push = () => {
    if (!current.some((ch) => ch.c.trim())) return;
    const b = bounds(current);
    const first = current.find((ch) => ch.c.trim())!;
    const baseline = Math.max(first.quad[5], first.quad[7]);
    cells.push({ chars: current, ...b, baseline, size: first.size });
  };
  for (const ch of chars) {
    const left = Math.min(ch.quad[0], ch.quad[4]);
    if (lastRight !== null && ch.c.trim() && left - lastRight > ch.size * 1.5) {
      push();
      current = [];
    }
    current.push(ch);
    if (ch.c.trim()) lastRight = Math.max(ch.quad[2], ch.quad[6]);
  }
  push();
  return cells;
}

type Column = { x0: number; x1: number };

const matches = (cell: Cell, col: Column) =>
  Math.abs(cell.x0 - col.x0) < EDGE || Math.abs(cell.x1 - col.x1) < EDGE;

/** Finds tables: ≥2 consecutive rows of ≥2 cells whose cells line up on shared columns. */
function findTables(rows: Line[]): { start: number; end: number; columns: Column[] }[] {
  const tables: { start: number; end: number; columns: Column[] }[] = [];
  let i = 0;
  while (i < rows.length) {
    const first = rows[i]!;
    if (first.cells.length < 2) {
      i++;
      continue;
    }
    const columns: Column[] = first.cells.map((c) => ({ x0: c.x0, x1: c.x1 }));
    let j = i + 1;
    while (j < rows.length) {
      const row = rows[j]!;
      const prev = rows[j - 1]!;
      if (row.cells.length < 2 || row.top - prev.bottom > Math.max(prev.size, row.size) * 2) break;
      const matched = row.cells.filter((c) => columns.some((col) => matches(c, col)));
      if (matched.length !== row.cells.length || matched.length < 2) break;
      j++;
    }
    if (j - i >= 2) {
      tables.push({ start: i, end: j, columns: columns.sort((a, b) => a.x0 - b.x0) });
      i = j;
    } else {
      i++;
    }
  }
  return tables;
}

function alignment(lines: Line[], pageWidth: number): 'left' | 'center' | 'right' {
  const centers = lines.map((l) => (l.x0 + l.x1) / 2);
  if (lines.length === 1) {
    const l = lines[0]!;
    if (Math.abs(centers[0]! - pageWidth / 2) < 3 && l.x0 > 90) return 'center';
    if (l.x1 > pageWidth - 80 && l.x0 > pageWidth / 2) return 'right';
    return 'left';
  }
  const same = (vals: number[]) => Math.max(...vals) - Math.min(...vals) < EDGE;
  const lefts = lines.map((l) => l.x0);
  const rights = lines.map((l) => l.x1);
  if (same(centers) && !same(lefts)) return 'center';
  if (same(rights) && !same(lefts)) return 'right';
  return 'left';
}

function pageModel(doc: mupdf.Document, index: number): DocPage {
  const page = doc.loadPage(index);
  const [x0, y0, x1, y1] = page.getBounds();
  const width = x1 - x0;
  const height = y1 - y0;
  const rawLines: Char[][] = [];
  const images: { top: number; block: DocBlock }[] = [];
  let line: Char[] = [];
  const stext = page.toStructuredText('preserve-images');
  try {
    stext.walk({
      onImageBlock(bbox, _transform, image) {
        try {
          let pix = image.toPixmap();
          const cs = pix.getColorSpace();
          if (cs && !cs.isRGB() && !cs.isGray())
            pix = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, pix.getAlpha() > 0);
          images.push({
            top: bbox[1],
            block: {
              kind: 'image',
              png: pix.asPNG(),
              width: bbox[2] - bbox[0],
              height: bbox[3] - bbox[1],
            },
          });
        } catch {
          // An image that can't be decoded is left out of the export.
        }
      },
      onChar(c, _origin, font, size, quad, color) {
        line.push({ c, quad, size, font: font.getName(), color: toColor(color) });
      },
      endLine() {
        if (line.some((ch) => ch.c.trim())) rawLines.push(line);
        line = [];
      },
    });
  } finally {
    stext.destroy();
    page.destroy();
  }

  // Rows: cells sharing a baseline, even when the PDF split them into separate lines.
  const cells = rawLines.flatMap(cellsOf).sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0);
  const rows: Line[] = [];
  for (const cell of cells) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.baseline - cell.baseline) < Math.max(1.5, cell.size * 0.2)) {
      row.cells.push(cell);
      row.x0 = Math.min(row.x0, cell.x0);
      row.x1 = Math.max(row.x1, cell.x1);
      row.top = Math.min(row.top, cell.top);
      row.bottom = Math.max(row.bottom, cell.bottom);
    } else {
      rows.push({
        cells: [cell],
        x0: cell.x0,
        x1: cell.x1,
        top: cell.top,
        bottom: cell.bottom,
        baseline: cell.baseline,
        size: cell.size,
      });
    }
  }
  for (const row of rows) row.cells.sort((a, b) => a.x0 - b.x0);

  const blocks: { top: number; block: DocBlock }[] = [...images];
  const tables = findTables(rows);
  const inTable = new Set<number>();
  for (const t of tables) {
    const tableRows: DocRun[][][] = [];
    for (let r = t.start; r < t.end; r++) {
      inTable.add(r);
      tableRows.push(
        t.columns.map((col) => {
          const cell = rows[r]!.cells.find((c) => matches(c, col));
          return cell ? trimRuns(runsOf(cell.chars)) : [];
        }),
      );
    }
    blocks.push({ top: rows[t.start]!.top, block: { kind: 'table', rows: tableRows } });
  }

  // Paragraphs: consecutive rows that look like wrapped lines of the same text.
  let para: Line[] = [];
  let prevBottom = 0;
  const flush = () => {
    if (!para.length) return;
    const runs: DocRun[] = [];
    para.forEach((l, i) => {
      const lineRuns = l.cells.flatMap((c, ci) =>
        ci === 0 ? runsOf(c.chars) : [{ ...runsOf(c.chars)[0]!, text: ' ' }, ...runsOf(c.chars)],
      );
      const trimmed = trimRuns(lineRuns);
      if (i > 0 && trimmed.length) {
        const last = runs[runs.length - 1]!;
        // "sec-" + "ond" -> "second"; otherwise lines are joined with a space.
        if (/[a-z]-$/.test(last.text) && /^[a-z]/.test(trimmed[0]!.text))
          last.text = last.text.slice(0, -1);
        else last.text += ' ';
      }
      for (const r of trimmed) {
        const prev = runs[runs.length - 1];
        if (
          prev &&
          prev.size === r.size &&
          prev.bold === r.bold &&
          prev.italic === r.italic &&
          prev.color.every((v, k) => v === r.color[k])
        ) {
          prev.text += r.text;
        } else {
          runs.push({ ...r });
        }
      }
    });
    blocks.push({
      top: para[0]!.top,
      block: {
        kind: 'paragraph',
        align: alignment(para, width),
        runs,
        spaceBefore: Math.max(0, para[0]!.top - prevBottom),
      },
    });
    prevBottom = para[para.length - 1]!.bottom;
    para = [];
  };
  rows.forEach((row, r) => {
    if (inTable.has(r)) {
      flush();
      prevBottom = row.bottom;
      return;
    }
    if (row.cells.length > 1) {
      // Side-by-side text that isn't a table (e.g. a title left, an invoice number right):
      // one paragraph per piece, each with its own alignment.
      flush();
      for (const cell of row.cells) {
        para = [
          { ...row, cells: [cell], x0: cell.x0, x1: cell.x1, top: cell.top, bottom: cell.bottom },
        ];
        flush();
      }
      return;
    }
    const prev = para[para.length - 1];
    const continues =
      prev &&
      row.cells.length === 1 &&
      prev.cells.length === 1 &&
      row.baseline - prev.baseline <= Math.max(prev.size, row.size) * 1.6 &&
      Math.abs(row.size - prev.size) < 0.5 &&
      (Math.abs(row.x0 - prev.x0) < EDGE ||
        Math.abs((row.x0 + row.x1) / 2 - (prev.x0 + prev.x1) / 2) < EDGE);
    if (!continues) flush();
    para.push(row);
  });
  flush();

  blocks.sort((a, b) => a.top - b.top);
  return { width, height, blocks: blocks.map((b) => b.block) };
}

/** The document model of every page (or the given pages). */
export function documentModel(doc: mupdf.Document, pages?: number[]): DocPage[] {
  const indices = pages ?? Array.from({ length: doc.countPages() }, (_, i) => i);
  return indices.map((i) => pageModel(doc, i));
}
