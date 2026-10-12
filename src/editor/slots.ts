import { LINE_HEIGHT } from '../shared/fonts';
import type { Point, Rect, Slot, TextRun, TextSpec, TextStyle } from '../shared/types';
import type { EditorObject } from './objects';
import { DEFAULT_TEXT_STYLE } from './tools';

// Click-to-fill on flat forms: which detected boxes can be filled, and the text that fills
// them. Filling is ordinary added text, so undo, saving and export need nothing new.

const PAD = 3; // points between a box's left edge and the text
const MIN_SIZE = 6;
const MAX_SIZE = 12;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const contains = (r: Rect, p: Point) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const shrink = (r: Rect, d: number): Rect => ({
  x: r.x + d,
  y: r.y + d,
  w: r.w - 2 * d,
  h: r.h - 2 * d,
});

/**
 * The boxes worth offering: those without the PDF's own text in them (a white cell holding a
 * label is not a blank). Text the user added doesn't count, so a filled box stays clickable.
 */
export function usableSlots(
  slots: Slot[],
  runs: TextRun[],
  objects: EditorObject[],
  page: number,
): Slot[] {
  const addedBoxes = objects.flatMap((o) =>
    o.kind === 'text' && o.page === page ? [o.spec.box] : [],
  );
  const printed = runs.filter((r) => !addedBoxes.some((b) => contains(b, centre(r.bbox))));
  // Shrunk by a point: a label that merely touches a border isn't inside the box.
  return slots.filter((s) => !printed.some((r) => overlaps(shrink(s.rect, 1), r.bbox)));
}

/** The innermost box under a point. */
export function slotAt(slots: Slot[], p: Point): Slot | null {
  let best: Slot | null = null;
  for (const s of slots) {
    if (contains(s.rect, p) && (!best || s.rect.w * s.rect.h < best.rect.w * best.rect.h)) best = s;
  }
  return best;
}

/** An empty text box sized to the slot, vertically centred, just inside its left edge. */
export function textSpecForSlot(slot: Slot): TextSpec {
  const { rect } = slot;
  const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, rect.h * 0.6));
  const h = size * LINE_HEIGHT;
  return {
    box: { x: rect.x + PAD, y: rect.y + (rect.h - h) / 2, w: 4, h },
    text: '',
    style: { ...DEFAULT_TEXT_STYLE, size },
  };
}

/** An "X" centred in a checkbox. */
export function checkSpecForSlot(
  slot: Slot,
  measure: (text: string, style: TextStyle) => number,
): TextSpec {
  const { rect } = slot;
  const style = { ...DEFAULT_TEXT_STYLE, size: Math.min(rect.w, rect.h) * 0.8 };
  const w = measure('X', style);
  const h = style.size * LINE_HEIGHT;
  return {
    box: { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h },
    text: 'X',
    style,
  };
}

/** The "X" the user already put in this checkbox, if any. */
export function checkMarkIn(
  slot: Slot,
  objects: EditorObject[],
  page: number,
): EditorObject | null {
  return (
    objects.find(
      (o) =>
        o.kind === 'text' &&
        o.page === page &&
        o.spec.text.trim().toUpperCase() === 'X' &&
        contains(slot.rect, centre(o.spec.box)),
    ) ?? null
  );
}
