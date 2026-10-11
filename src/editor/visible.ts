import type { PageInfo } from '../shared/types';

export const PAGE_GAP = 16;

/** Top y (CSS px) of each page in the scroll container, with a gap above every page. */
export function pageOffsets(pages: PageInfo[], zoom: number, gap = PAGE_GAP): number[] {
  const offsets: number[] = [];
  let y = gap;
  for (const p of pages) {
    offsets.push(y);
    y += p.height * zoom + gap;
  }
  return offsets;
}

/** Index of the last page whose top is at or above `y` (binary search). */
export function pageAtOffset(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Pages intersecting [scrollTop, scrollTop + viewportH], plus `overscan` each side (spec §3.4). */
export function visibleRange(
  offsets: number[],
  scrollTop: number,
  viewportH: number,
  overscan = 1,
): [first: number, last: number] {
  if (offsets.length === 0) return [0, -1];
  const first = pageAtOffset(offsets, scrollTop);
  let last = first;
  const bottom = scrollTop + viewportH;
  while (last + 1 < offsets.length && offsets[last + 1]! < bottom) last++;
  return [Math.max(0, first - overscan), Math.min(offsets.length - 1, last + overscan)];
}
