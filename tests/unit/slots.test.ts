import { describe, expect, it } from 'vitest';
import type { EditorObject } from '../../src/editor/objects';
import {
  addedTextIn,
  checkMarkIn,
  checkSpecForSlot,
  textSpecForSlot,
  usableSlots,
} from '../../src/editor/slots';
import { DEFAULT_TEXT_STYLE } from '../../src/editor/tools';
import type { Rect, Slot, TextRun } from '../../src/shared/types';

const run = (text: string, bbox: Rect): TextRun =>
  ({ text, bbox, baseline: bbox.y + bbox.h * 0.8, x0: bbox.x, x1: bbox.x + bbox.w }) as TextRun;
const added = (id: string, text: string, box: Rect, page = 0): EditorObject => ({
  id,
  page,
  kind: 'text',
  spec: { box, text, style: DEFAULT_TEXT_STYLE },
});
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

const name: Slot = { kind: 'text', rect: { x: 200, y: 100, w: 360, h: 22 } };
const label: Slot = { kind: 'text', rect: { x: 50, y: 122, w: 510, h: 22 } };
const yes: Slot = { kind: 'check', rect: { x: 70, y: 151, w: 12, h: 12 } };

describe('usableSlots', () => {
  it("drops boxes that hold the PDF's own text (label cells)", () => {
    const runs = [run('Printed label', { x: 56, y: 128, w: 60, h: 11 })];
    expect(usableSlots([name, label, yes], runs, [], 0)).toEqual([name, yes]);
  });

  it('keeps a box the user already typed into', () => {
    const typed = added('t1', 'JUAN', { x: 203, y: 104, w: 40, h: 14 });
    const runs = [run('JUAN', { x: 203, y: 105, w: 38, h: 12 })];
    expect(usableSlots([name], runs, [typed], 0)).toEqual([name]);
    // Added text on another page doesn't excuse text here.
    expect(usableSlots([name], runs, [{ ...typed, page: 1 }], 0)).toEqual([]);
  });

  it('ignores text that only touches the border', () => {
    const runs = [run('Name', { x: 56, y: 100.5, w: 144.5, h: 11 })];
    expect(usableSlots([name], runs, [], 0)).toEqual([name]);
  });
});

describe('fill specs', () => {
  it('fits a text box inside the slot, vertically centred', () => {
    const spec = textSpecForSlot(name);
    expect(spec.text).toBe('');
    expect(spec.style.size).toBeCloseTo(12, 5); // 22 × 0.6 = 13.2, capped at 12
    expect(spec.box.x).toBeCloseTo(203, 5);
    expect(inside(spec.box, name.rect)).toBe(true);
    const top = spec.box.y - name.rect.y;
    const bottom = name.rect.y + name.rect.h - (spec.box.y + spec.box.h);
    expect(Math.abs(top - bottom)).toBeLessThan(0.01);
    expect(textSpecForSlot({ kind: 'text', rect: { x: 0, y: 0, w: 50, h: 8 } }).style.size).toBe(6);
  });

  it('centres an X in a checkbox', () => {
    const spec = checkSpecForSlot(yes, (text, style) => text.length * style.size * 0.6);
    expect(spec.text).toBe('X');
    expect(spec.style.size).toBeCloseTo(9.6, 5);
    const cx = spec.box.x + spec.box.w / 2;
    const cy = spec.box.y + spec.box.h / 2;
    expect(cx).toBeCloseTo(76, 5);
    expect(cy).toBeCloseTo(157, 5);
  });

  it('finds the X already in a checkbox', () => {
    const box = { x: 72, y: 151, w: 7, h: 11 };
    const x = added('x1', 'X', box);
    expect(checkMarkIn(yes, [x], 0)?.id).toBe('x1');
    expect(checkMarkIn(yes, [x], 1)).toBeNull();
    expect(checkMarkIn(yes, [added('t', 'JUAN', box)], 0)).toBeNull();
  });
});

describe('addedTextIn', () => {
  it('finds the text the user already typed in a box', () => {
    const typed = added('t1', 'JUAN', { x: 203, y: 104, w: 40, h: 14 });
    expect(addedTextIn(name, [typed], 0)?.id).toBe('t1');
    expect(addedTextIn(name, [typed], 1)).toBeNull();
    expect(addedTextIn(yes, [typed], 0)).toBeNull();
  });
});
