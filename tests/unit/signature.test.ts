import { describe, expect, it } from 'vitest';
import {
  fitWithin,
  removeBackground,
  smoothStroke,
  trimTransparent,
} from '../../src/editor/signature';

describe('smoothStroke', () => {
  it('keeps the endpoints and rounds corners', () => {
    const out = smoothStroke([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 10, y: 10 });
    expect(out.length).toBeGreaterThan(3);
    // The sharp corner at (10, 0) is cut.
    expect(out.some((p) => p.x === 10 && p.y === 0)).toBe(false);
  });
  it('passes through short strokes unchanged', () => {
    expect(smoothStroke([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
    expect(
      smoothStroke([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ]),
    ).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });
});

/** RGBA pixels from a list of [r, g, b, a] tuples. */
const rgba = (...px: number[][]) => new Uint8ClampedArray(px.flat());

describe('removeBackground', () => {
  it('makes light pixels transparent and keeps dark ink', () => {
    const out = removeBackground(
      rgba([255, 255, 255, 255], [20, 20, 30, 255], [235, 235, 235, 255]),
      200,
    );
    expect(out[3]).toBe(0); // white -> transparent
    expect(out[7]).toBe(255); // ink stays
    expect(out[11]).toBe(0); // paper grey above threshold
  });
  it('softens pixels just below the threshold', () => {
    const out = removeBackground(rgba([190, 190, 190, 255]), 200);
    expect(out[3]).toBeGreaterThan(0);
    expect(out[3]).toBeLessThan(255);
  });
  it('does not modify its input', () => {
    const input = rgba([255, 255, 255, 255]);
    removeBackground(input, 200);
    expect(input[3]).toBe(255);
  });
});

describe('trimTransparent', () => {
  it('finds the bounding box of visible pixels', () => {
    // 4×3 image with one visible pixel at (2, 1).
    const px = new Uint8ClampedArray(4 * 3 * 4);
    px[(1 * 4 + 2) * 4 + 3] = 255;
    expect(trimTransparent(px, 4, 3)).toEqual({ x: 2, y: 1, w: 1, h: 1 });
  });
  it('returns null for a fully transparent image', () => {
    expect(trimTransparent(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
});

describe('fitWithin', () => {
  it('scales down keeping aspect, never up', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });
});
