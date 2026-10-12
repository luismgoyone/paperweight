/** Inclusive, 0-based page ranges for splitting a document. */
export type PageRange = [first: number, last: number];

export function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/**
 * Ranges for "split every N pages" or a custom list like "1-3, 5, 8-10" (1-based, as people
 * type them). Throws with a readable message for invalid input.
 */
export function splitRanges(
  pageCount: number,
  how: { every: number } | { ranges: string },
): PageRange[] {
  if ('every' in how) {
    if (!Number.isInteger(how.every) || how.every < 1) throw new Error('Enter a number of pages');
    const out: PageRange[] = [];
    for (let first = 0; first < pageCount; first += how.every) {
      out.push([first, Math.min(pageCount, first + how.every) - 1]);
    }
    return out;
  }
  const parts = how.ranges
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error('Enter page ranges, for example 1-3, 5');
  return parts.map((part) => {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(`"${part}" isn't a page range`);
    const first = Number(m[1]);
    const last = m[2] ? Number(m[2]) : first;
    if (first < 1 || last > pageCount || first > last) {
      throw new Error(`"${part}" is outside pages 1–${pageCount}`);
    }
    return [first - 1, last - 1];
  });
}
