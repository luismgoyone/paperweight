import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';
import { findSlots } from '../../src/engine/slots';
import type { Rect } from '../../src/shared/types';
import { fixture } from './helpers';

const open = (name: string) => mupdf.Document.openDocument(fixture(name), 'application/pdf');
const near = (r: Rect, x0: number, y0: number, x1: number, y1: number, tol = 2) =>
  Math.abs(r.x - x0) < tol &&
  Math.abs(r.y - y0) < tol &&
  Math.abs(r.x + r.w - x1) < tol &&
  Math.abs(r.y + r.h - y1) < tol;

describe('findSlots', () => {
  const slots = findSlots(open('flat-form.pdf'), 0);
  const text = slots.filter((s) => s.kind === 'text');
  const checks = slots.filter((s) => s.kind === 'check');

  it('finds the blank cell next to a grey label', () => {
    expect(text.some((s) => near(s.rect, 200.75, 100.75, 560, 122))).toBe(true);
  });

  it('finds the comb cell as one box (ticks do not split it)', () => {
    expect(text.filter((s) => s.rect.y > 170 && s.rect.y < 172)).toHaveLength(1);
  });

  it('finds the three checkboxes', () => {
    expect(checks).toHaveLength(3);
    // Inside the stroked 12 pt squares at x 70, 170 and 270.
    const xs = checks.map((c) => c.rect.x).sort((a, b) => a - b);
    xs.forEach((x, i) => expect(Math.abs(x - (70 + i * 100))).toBeLessThan(1.5));
    for (const c of checks) expect(c.rect.w).toBeGreaterThan(10);
  });

  it('never returns the grey label cell or the area around the form', () => {
    for (const s of slots) {
      expect(s.rect.x).toBeGreaterThan(49);
      expect(s.rect.x + s.rect.w).toBeLessThan(561);
      expect(near(s.rect, 50.75, 100.75, 200, 122, 4)).toBe(false);
    }
  });

  it('finds nothing on a page without boxes', () => {
    expect(findSlots(open('simple.pdf'), 0)).toEqual([]);
  });
});

function pagePdf(width: number, height: number, content: string, rotate: 0 | 90 = 0) {
  const doc = new mupdf.PDFDocument();
  const page = doc.addPage([0, 0, width, height], rotate, doc.addObject({}), content);
  doc.insertPage(-1, page);
  return mupdf.Document.openDocument(
    doc.saveToBuffer('').asUint8Array().slice(),
    'application/pdf',
  );
}

// A 1000 × 40 pt box outlined with 1 pt lines, 100 pt from the top-left corner.
const box = (pageHeight: number) =>
  `0 g 100 ${pageHeight - 140} 1000 1 re f 100 ${pageHeight - 101} 1000 1 re f ` +
  `100 ${pageHeight - 140} 1 40 re f 1099 ${pageHeight - 140} 1 40 re f`;

describe('findSlots limits', () => {
  it('keeps its memory bounded on huge pages and still finds large boxes', () => {
    const start = performance.now();
    const slots = findSlots(pagePdf(6000, 6000, box(6000)), 0);
    expect(performance.now() - start).toBeLessThan(1500);
    expect(slots.some((s) => s.kind === 'text' && s.rect.w > 990 && s.rect.w < 1000)).toBe(true);
  });

  it('skips boxes too tall and narrow for a line of text (e.g. a rotated page)', () => {
    const slots = findSlots(pagePdf(1200, 1200, box(1200), 90), 0);
    expect(slots).toEqual([]);
  });

  it('on pages without text (scans), ignores holes smaller than 10 pt', () => {
    // A 9 pt square outline: a box on a page with text, but too small to trust on a scan.
    const square =
      '0 g 100 600 9 0.75 re f 100 608.25 9 0.75 re f 100 600 0.75 9 re f 108.25 600 0.75 9 re f';
    expect(findSlots(pagePdf(612, 792, square), 0)).toEqual([]);
  });
});
