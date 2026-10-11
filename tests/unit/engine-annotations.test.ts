import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { OpError } from '../../src/engine/ops';
import type { AnnotSpec, Op, Quad } from '../../src/shared/types';
import { fixture } from './helpers';

const RED: [number, number, number] = [1, 0, 0];
const BLUE: [number, number, number] = [0, 0, 1];

function session(name = 'simple.pdf') {
  const s = new EngineSession();
  s.open(fixture(name));
  return s;
}

function reopenAnnots(s: EngineSession, page = 0) {
  const doc = mupdf.Document.openDocument(s.save(), 'application/pdf').asPDF()!;
  return doc.loadPage(page).getAnnotations();
}

const quad = (x: number, y: number, w: number, h: number): Quad => [
  { x, y },
  { x: x + w, y },
  { x, y: y + h },
  { x: x + w, y: y + h },
];

const add = (id: string, annot: AnnotSpec, page = 0): Op => ({
  kind: 'annot.add',
  id,
  page,
  annot,
});

describe('annotation ops', () => {
  it.each<[string, AnnotSpec, string]>([
    [
      'highlight',
      { type: 'highlight', quads: [quad(72, 100, 100, 12)], color: [1, 1, 0], opacity: 0.5 },
      'Highlight',
    ],
    [
      'underline',
      { type: 'underline', quads: [quad(72, 100, 100, 12)], color: RED, opacity: 1 },
      'Underline',
    ],
    [
      'strikeout',
      { type: 'strikeout', quads: [quad(72, 100, 100, 12)], color: RED, opacity: 1 },
      'StrikeOut',
    ],
    [
      'ink',
      {
        type: 'ink',
        paths: [
          [
            { x: 100, y: 100 },
            { x: 150, y: 140 },
            { x: 200, y: 110 },
          ],
        ],
        color: BLUE,
        width: 2,
        opacity: 1,
      },
      'Ink',
    ],
    [
      'rect',
      {
        type: 'rect',
        rect: { x: 100, y: 200, w: 120, h: 60 },
        color: RED,
        fill: null,
        width: 1.5,
        opacity: 1,
      },
      'Square',
    ],
    [
      'ellipse',
      {
        type: 'ellipse',
        rect: { x: 100, y: 200, w: 120, h: 60 },
        color: RED,
        fill: BLUE,
        width: 1,
        opacity: 1,
      },
      'Circle',
    ],
    [
      'line',
      {
        type: 'line',
        a: { x: 100, y: 300 },
        b: { x: 250, y: 320 },
        color: RED,
        width: 2,
        opacity: 1,
      },
      'Line',
    ],
    [
      'arrow',
      {
        type: 'arrow',
        a: { x: 100, y: 300 },
        b: { x: 250, y: 320 },
        color: RED,
        width: 2,
        opacity: 1,
      },
      'Line',
    ],
    [
      'note',
      { type: 'note', at: { x: 300, y: 300 }, text: 'Check this', color: [1, 0.8, 0] },
      'Text',
    ],
  ])('%s round-trips through save', (_, annot, pdfType) => {
    const s = session();
    s.setOps([add('a1', annot)]);
    const [saved, ...rest] = reopenAnnots(s);
    expect(rest).toHaveLength(0);
    expect(saved!.getType()).toBe(pdfType);
    expect(saved!.getName()).toBe('a1');
    const round = (c: number[]) => c.map((n) => Math.round(n * 1000) / 1000);
    expect(round(saved!.getColor())).toEqual(annot.color);
    if (annot.type === 'note') expect(saved!.getContents()).toBe('Check this');
    if (annot.type === 'arrow') expect(saved!.getLineEndingStyles().end).toBe('OpenArrow');
    if (annot.type === 'line') expect(saved!.getLineEndingStyles().end).toBe('None');
    if (annot.type === 'ellipse') expect(saved!.getInteriorColor()).toEqual(BLUE);
  });

  it('places a rectangle at the requested page-space rect', () => {
    const s = session();
    s.setOps([
      add('r', {
        type: 'rect',
        rect: { x: 100, y: 200, w: 120, h: 60 },
        color: RED,
        fill: null,
        width: 2,
        opacity: 1,
      }),
    ]);
    const [annot] = reopenAnnots(s);
    const [x0, y0, x1, y1] = annot!.getRect();
    expect([x0, y0, x1, y1].map(Math.round)).toEqual([100, 200, 220, 260]);
  });

  it('places annotations correctly on rotated and offset pages', () => {
    for (const page of [0, 1]) {
      const s = session('rotated.pdf');
      const rect = { x: 50, y: 60, w: 100, h: 40 };
      s.setOps([
        add('r', { type: 'rect', rect, color: RED, fill: null, width: 1, opacity: 1 }, page),
      ]);
      const [annot] = reopenAnnots(s, page);
      const [x0, y0, x1, y1] = annot!.getRect();
      expect([x0, y0, x1, y1].map(Math.round)).toEqual([50, 60, 150, 100]);
    }
  });

  it('updates and deletes by id, and undo restores each state', () => {
    const s = session();
    const base: AnnotSpec = {
      type: 'rect',
      rect: { x: 100, y: 100, w: 50, h: 50 },
      color: RED,
      fill: null,
      width: 1,
      opacity: 1,
    };
    const moved: AnnotSpec = { ...base, rect: { x: 300, y: 300, w: 50, h: 50 }, color: BLUE };
    const ops: Op[] = [
      add('x', base),
      { kind: 'annot.update', id: 'x', page: 0, annot: moved },
      { kind: 'annot.delete', id: 'x', page: 0 },
    ];
    const live = () => s.doc.loadPage(0).getAnnotations();

    s.setOps(ops);
    expect(live()).toHaveLength(0);
    s.setOps(ops.slice(0, 2));
    expect(live()[0]!.getColor()).toEqual(BLUE);
    expect(Math.round(live()[0]!.getRect()[0])).toBe(300);
    s.setOps(ops.slice(0, 1));
    expect(live()[0]!.getColor()).toEqual(RED);
    s.setOps([]);
    expect(live()).toHaveLength(0);
  });

  it('rejects updates to unknown ids without changing the document', () => {
    const s = session();
    const base: AnnotSpec = { type: 'note', at: { x: 10, y: 10 }, text: 'a', color: RED };
    s.setOps([add('n', base)]);
    expect(() =>
      s.setOps([add('n', base), { kind: 'annot.delete', id: 'missing', page: 0 }]),
    ).toThrow(OpError);
    expect(s.doc.loadPage(0).getAnnotations()).toHaveLength(1);
  });

  it('reports the touched page so only it re-renders', () => {
    const s = session();
    const { changedPages } = s.setOps([
      add('n', { type: 'note', at: { x: 10, y: 10 }, text: 'a', color: RED }, 2),
    ]);
    expect(changedPages).toEqual([2]);
  });
});
