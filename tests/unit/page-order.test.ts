import { describe, expect, it } from 'vitest';
import { moveOrder, rangeSelect } from '../../src/editor/page-order';

describe('moveOrder', () => {
  it('moves one page down', () => {
    // pages 0..4, move page 1 to before index 4
    expect(moveOrder(5, [1], 4)).toEqual([0, 2, 3, 1, 4]);
  });
  it('moves several pages to the top, keeping their order', () => {
    expect(moveOrder(5, [3, 1], 0)).toEqual([1, 3, 0, 2, 4]);
  });
  it('moves to the very end', () => {
    expect(moveOrder(4, [0], 4)).toEqual([1, 2, 3, 0]);
  });
  it('returns null when nothing would change', () => {
    expect(moveOrder(4, [1], 1)).toBeNull();
    expect(moveOrder(4, [1], 2)).toBeNull();
    expect(moveOrder(4, [1, 2], 2)).toBeNull();
  });
});

describe('rangeSelect', () => {
  it('selects the span between anchor and target', () => {
    expect(rangeSelect(2, 5)).toEqual([2, 3, 4, 5]);
    expect(rangeSelect(5, 2)).toEqual([2, 3, 4, 5]);
  });
});
