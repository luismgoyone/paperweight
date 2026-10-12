import { describe, expect, it } from 'vitest';
import { snapBox, type SnapTarget } from '../../src/editor/snapping';

// `$26` in the invoice fixture: right edge 540, baseline 196.
const amount: SnapTarget = { x0: 522.2, x1: 540, baseline: 196 };
const description: SnapTarget = { x0: 72, x1: 145, baseline: 196 };

describe('snapBox', () => {
  it('snaps the right edge exactly to a run’s right edge', () => {
    const { box, guides } = snapBox({ x: 437.3, y: 300, w: 100, h: 12 }, 9, [amount], 4);
    expect(box.x + box.w).toBe(540);
    expect(guides).toContainEqual(expect.objectContaining({ axis: 'x', at: 540 }));
  });

  it('snaps the left edge exactly', () => {
    const { box } = snapBox({ x: 74.5, y: 300, w: 50, h: 12 }, 9, [description], 4);
    expect(box.x).toBe(72);
  });

  it('snaps the baseline exactly', () => {
    const { box, guides } = snapBox({ x: 300, y: 185.6, w: 50, h: 12 }, 9, [amount], 4);
    expect(box.y + 9).toBe(196);
    expect(guides).toContainEqual(expect.objectContaining({ axis: 'y', at: 196 }));
  });

  it('snaps x and y independently, choosing the closest candidate', () => {
    const { box } = snapBox({ x: 73, y: 187.5, w: 100, h: 12 }, 9, [amount, description], 4);
    expect(box.x).toBe(72);
    expect(box.y + 9).toBe(196);
  });

  it('does not snap beyond the threshold', () => {
    const input = { x: 300, y: 300, w: 50, h: 12 };
    const { box, guides } = snapBox(input, 9, [amount, description], 4);
    expect(box).toEqual(input);
    expect(guides).toEqual([]);
  });

  it('guides span both the box and the target', () => {
    const { guides } = snapBox({ x: 437.3, y: 300, w: 100, h: 12 }, 9, [amount], 4);
    const g = guides.find((x) => x.axis === 'x')!;
    expect(g.from).toBeLessThanOrEqual(196 - 10);
    expect(g.to).toBeGreaterThanOrEqual(312);
  });
});
