import { describe, expect, it } from 'vitest';
import { foldObjects, hitTest, objectBounds, translate } from '../../src/editor/objects';
import type { AnnotSpec, Op, TextSpec } from '../../src/shared/types';

const RED: [number, number, number] = [1, 0, 0];
const rect = (x: number, y: number): AnnotSpec => ({
  type: 'rect',
  rect: { x, y, w: 50, h: 20 },
  color: RED,
  fill: null,
  width: 2,
  opacity: 1,
});
const text: TextSpec = {
  box: { x: 10, y: 10, w: 100, h: 12 },
  text: 'Hi',
  style: { family: 'Inter', size: 10, color: RED, align: 'left', bold: false, italic: false },
};

describe('foldObjects', () => {
  it('applies add, update and delete in order', () => {
    const ops: Op[] = [
      { kind: 'meta.setTitle', title: 'x' },
      { kind: 'annot.add', id: 'a', page: 0, annot: rect(0, 0) },
      { kind: 'text.add', id: 't', page: 1, spec: text },
      { kind: 'annot.update', id: 'a', page: 0, annot: rect(100, 100) },
      { kind: 'annot.add', id: 'b', page: 0, annot: rect(5, 5) },
      { kind: 'annot.delete', id: 'b', page: 0 },
    ];
    const objects = foldObjects(ops);
    expect([...objects.keys()]).toEqual(['a', 't']);
    const a = objects.get('a')!;
    expect(a.kind === 'annot' && a.annot.type === 'rect' && a.annot.rect.x).toBe(100);
    expect(objects.get('t')!.page).toBe(1);
  });
});

describe('objectBounds', () => {
  it('pads strokes by half their width', () => {
    expect(objectBounds({ id: 'a', page: 0, kind: 'annot', annot: rect(10, 10) })).toEqual({
      x: 9,
      y: 9,
      w: 52,
      h: 22,
    });
  });
  it('bounds ink paths', () => {
    const ink: AnnotSpec = {
      type: 'ink',
      paths: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 20 },
        ],
      ],
      color: RED,
      width: 4,
      opacity: 1,
    };
    expect(objectBounds({ id: 'i', page: 0, kind: 'annot', annot: ink })).toEqual({
      x: -2,
      y: -2,
      w: 14,
      h: 24,
    });
  });
  it('bounds markup quads and lines', () => {
    const hl: AnnotSpec = {
      type: 'highlight',
      quads: [
        [
          { x: 1, y: 2 },
          { x: 11, y: 2 },
          { x: 1, y: 12 },
          { x: 11, y: 12 },
        ],
      ],
      color: RED,
      opacity: 1,
    };
    expect(objectBounds({ id: 'h', page: 0, kind: 'annot', annot: hl })).toEqual({
      x: 1,
      y: 2,
      w: 10,
      h: 10,
    });
    const line: AnnotSpec = {
      type: 'arrow',
      a: { x: 0, y: 10 },
      b: { x: 20, y: 0 },
      color: RED,
      width: 2,
      opacity: 1,
    };
    expect(objectBounds({ id: 'l', page: 0, kind: 'annot', annot: line })).toEqual({
      x: -1,
      y: -1,
      w: 22,
      h: 12,
    });
  });
  it('uses the box for text and a fixed square for notes', () => {
    expect(objectBounds({ id: 't', page: 0, kind: 'text', spec: text })).toEqual(text.box);
    const note: AnnotSpec = { type: 'note', at: { x: 5, y: 6 }, text: '', color: RED };
    expect(objectBounds({ id: 'n', page: 0, kind: 'annot', annot: note })).toEqual({
      x: 5,
      y: 6,
      w: 20,
      h: 20,
    });
  });
});

describe('hitTest', () => {
  const objects = [
    ...foldObjects([
      { kind: 'annot.add', id: 'under', page: 0, annot: rect(0, 0) },
      { kind: 'annot.add', id: 'over', page: 0, annot: rect(10, 5) },
      { kind: 'annot.add', id: 'other', page: 1, annot: rect(0, 0) },
    ]).values(),
  ];

  it('returns the topmost object on the page', () => {
    expect(hitTest(objects, 0, { x: 20, y: 10 }, 0)?.id).toBe('over');
    expect(hitTest(objects, 0, { x: 2, y: 2 }, 0)?.id).toBe('under');
  });
  it('respects the tolerance and the page', () => {
    expect(hitTest(objects, 0, { x: 64, y: 10 }, 0)).toBeUndefined();
    expect(hitTest(objects, 0, { x: 64, y: 10 }, 5)?.id).toBe('over');
    expect(hitTest(objects, 2, { x: 2, y: 2 }, 0)).toBeUndefined();
  });
});

describe('translate', () => {
  it('moves every kind of geometry', () => {
    const moved = translate({ id: 'a', page: 0, kind: 'annot', annot: rect(0, 0) }, 5, -3);
    expect(moved.kind === 'annot' && moved.annot.type === 'rect' && moved.annot.rect).toEqual({
      x: 5,
      y: -3,
      w: 50,
      h: 20,
    });
    const t = translate({ id: 't', page: 0, kind: 'text', spec: text }, 1, 2);
    expect(t.kind === 'text' && t.spec.box).toEqual({ x: 11, y: 12, w: 100, h: 12 });
    const ink: AnnotSpec = {
      type: 'ink',
      paths: [[{ x: 0, y: 0 }]],
      color: RED,
      width: 1,
      opacity: 1,
    };
    const i = translate({ id: 'i', page: 0, kind: 'annot', annot: ink }, 1, 1);
    expect(i.kind === 'annot' && i.annot.type === 'ink' && i.annot.paths).toEqual([
      [{ x: 1, y: 1 }],
    ]);
  });
});

describe('image objects', () => {
  const ops: Op[] = [
    { kind: 'image.add', id: 'img', page: 0, box: { x: 10, y: 20, w: 100, h: 50 }, image: 'k' },
    { kind: 'image.update', id: 'img', page: 0, box: { x: 30, y: 20, w: 100, h: 50 }, image: 'k' },
  ];
  it('folds, bounds and translates images', () => {
    const img = foldObjects(ops).get('img')!;
    expect(img.kind).toBe('image');
    expect(objectBounds(img)).toEqual({ x: 30, y: 20, w: 100, h: 50 });
    const moved = translate(img, 5, 5);
    expect(objectBounds(moved)).toEqual({ x: 35, y: 25, w: 100, h: 50 });
  });
  it('is removed by image.delete', () => {
    expect(foldObjects([...ops, { kind: 'image.delete', id: 'img', page: 0 }]).size).toBe(0);
  });
});
