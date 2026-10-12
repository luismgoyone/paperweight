/**
 * The new page order after moving `selected` pages so they sit before `dropIndex` (an index
 * in the current order, 0..count). Selected pages keep their relative order. Returns null if
 * the order wouldn't change.
 */
export function moveOrder(
  count: number,
  selected: readonly number[],
  dropIndex: number,
): number[] | null {
  const moving = [...new Set(selected)].sort((a, b) => a - b);
  const rest = Array.from({ length: count }, (_, i) => i).filter((i) => !moving.includes(i));
  // Where the drop point lands among the pages that stay.
  const insertAt = rest.filter((i) => i < dropIndex).length;
  const order = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
  return order.every((p, i) => p === i) ? null : order;
}

/** Pages from `anchor` to `target` inclusive (Shift-click selection). */
export function rangeSelect(anchor: number, target: number): number[] {
  const [a, b] = anchor < target ? [anchor, target] : [target, anchor];
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
