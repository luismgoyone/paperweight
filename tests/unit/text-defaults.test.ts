import { describe, expect, it } from 'vitest';
import { nearestRun, styleFromRun } from '../../src/editor/text-defaults';
import type { TextRun } from '../../src/shared/types';

const run = (
  text: string,
  x0: number,
  baseline: number,
  extra: Partial<TextRun> = {},
): TextRun => ({
  text,
  x0,
  x1: x0 + 40,
  baseline,
  bbox: { x: x0, y: baseline - 8, w: 40, h: 10 },
  font: 'Helvetica',
  size: 10,
  color: [0, 0, 0],
  ...extra,
});

describe('nearestRun', () => {
  const runs = [run('a', 72, 100), run('b', 400, 196), run('c', 72, 600)];
  it('picks the run closest to the point', () => {
    expect(nearestRun(runs, { x: 410, y: 210 })?.text).toBe('b');
    expect(nearestRun(runs, { x: 80, y: 590 })?.text).toBe('c');
  });
  it('returns undefined without runs', () => {
    expect(nearestRun([], { x: 0, y: 0 })).toBeUndefined();
  });
});

describe('styleFromRun', () => {
  it('maps the PDF font to a bundled family and keeps size and color', () => {
    const style = styleFromRun(
      run('x', 0, 0, { font: 'ABCDEF+Arial-BoldMT', size: 9.5, color: [0.2, 0.2, 0.2] }),
    );
    expect(style).toEqual({
      family: 'Liberation Sans',
      size: 9.5,
      color: [0.2, 0.2, 0.2],
      align: 'left',
      bold: true,
      italic: false,
    });
  });
  it('rounds odd sizes to a tenth of a point', () => {
    expect(styleFromRun(run('x', 0, 0, { size: 9.96 })).size).toBe(10);
  });
});
