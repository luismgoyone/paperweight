import * as mupdf from 'mupdf';
import type { Rect, SearchHit } from '../shared/types';

export type RGBAImage = { width: number; height: number; pixels: Uint8ClampedArray };

export function renderPageRGBA(doc: mupdf.Document, pageIndex: number, scale: number): RGBAImage {
  if (pageIndex < 0 || pageIndex >= doc.countPages()) {
    throw new RangeError(`Page ${pageIndex + 1} does not exist`);
  }
  const page = doc.loadPage(pageIndex);
  try {
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      true,
      true,
    );
    try {
      // Pages without a background are transparent; composite onto white.
      const pixels = new Uint8ClampedArray(pixmap.getPixels());
      for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3]!;
        if (a === 255) continue;
        // Pixmap samples are premultiplied: out = c + 255 * (1 - a)
        const inv = 255 - a;
        pixels[i] = pixels[i]! + inv;
        pixels[i + 1] = pixels[i + 1]! + inv;
        pixels[i + 2] = pixels[i + 2]! + inv;
        pixels[i + 3] = 255;
      }
      return { width: pixmap.getWidth(), height: pixmap.getHeight(), pixels };
    } finally {
      pixmap.destroy();
    }
  } finally {
    page.destroy();
  }
}

function quadToRect(q: mupdf.Quad): Rect {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Case-insensitive text search across all pages. One SearchHit per match. */
export function searchDocument(doc: mupdf.Document, needle: string, maxHits = 1000): SearchHit[] {
  if (!needle.trim()) return [];
  const hits: SearchHit[] = [];
  const count = doc.countPages();
  for (let index = 0; index < count && hits.length < maxHits; index++) {
    const page = doc.loadPage(index);
    try {
      for (const match of page.search(needle, 'ignore-case')) {
        hits.push({ page: index, rects: match.map(quadToRect) });
        if (hits.length >= maxHits) break;
      }
    } finally {
      page.destroy();
    }
  }
  return hits;
}
