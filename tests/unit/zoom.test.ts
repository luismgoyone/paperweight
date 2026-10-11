import { describe, expect, it } from 'vitest';
import { clampZoom, fitPage, fitWidth, zoomIn, zoomOut } from '../../src/editor/zoom';

describe('zoom', () => {
  it('clamps to 50–400%', () => {
    expect(clampZoom(10)).toBe(4);
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(1.3)).toBe(1.3);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('steps through presets', () => {
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomIn(1.1)).toBe(1.25);
    expect(zoomIn(4)).toBe(4);
    expect(zoomOut(1)).toBe(0.75);
    expect(zoomOut(1.1)).toBe(1);
    expect(zoomOut(0.5)).toBe(0.5);
  });

  it('fits width and page within the gutter, clamped', () => {
    expect(fitWidth(612, 660)).toBe(1);
    expect(fitPage(612, 792, 2000, 840)).toBeCloseTo((840 - 48) / 792);
    expect(fitWidth(612, 10)).toBe(0.5);
    expect(fitWidth(100, 5000)).toBe(4);
  });
});
