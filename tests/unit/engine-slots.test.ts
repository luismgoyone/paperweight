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
