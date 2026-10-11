import { describe, expect, it } from 'vitest';
import { pageAtOffset, pageOffsets, visibleRange } from '../../src/editor/visible';
import type { PageInfo } from '../../src/shared/types';

const letter = (n: number): PageInfo[] =>
  Array.from({ length: n }, (_, index) => ({ index, width: 612, height: 792 }));

describe('pageOffsets', () => {
  it('stacks pages with a gap, scaled by zoom', () => {
    expect(pageOffsets(letter(2), 1)).toEqual([16, 824]);
    expect(pageOffsets(letter(2), 0.5)).toEqual([16, 428]);
  });
  it('handles no pages', () => {
    expect(pageOffsets([], 1)).toEqual([]);
  });
});

describe('visibleRange', () => {
  const pages = letter(100);
  const offsets = pageOffsets(pages, 1);

  it('returns the visible pages plus one on each side', () => {
    expect(visibleRange(offsets, offsets[50]!, 700)).toEqual([49, 51]);
  });
  it('clamps at the start and end', () => {
    expect(visibleRange(offsets, 0, 700)).toEqual([0, 1]);
    expect(visibleRange(offsets, offsets[99]!, 700)).toEqual([98, 99]);
  });
  it('covers several pages in a tall viewport', () => {
    expect(visibleRange(offsets, offsets[10]!, 2000)).toEqual([9, 13]);
  });
  it('returns an empty range for no pages', () => {
    expect(visibleRange([], 0, 700)).toEqual([0, -1]);
  });
});

describe('pageAtOffset', () => {
  it('finds the page under a scroll position', () => {
    const offsets = pageOffsets(letter(10), 1);
    expect(pageAtOffset(offsets, 0)).toBe(0);
    expect(pageAtOffset(offsets, offsets[4]! + 10)).toBe(4);
    expect(pageAtOffset(offsets, 1e9)).toBe(9);
  });
});
