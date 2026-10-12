import * as mupdf from 'mupdf';
import { beforeAll, describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { registerDocument } from '../../src/engine/documents';
import { extractPages } from '../../src/engine/export';
import { range, splitRanges } from '../../src/shared/ranges';
import { OpError } from '../../src/engine/ops';
import type { Op } from '../../src/shared/types';
import { fixture } from './helpers';

beforeAll(() => {
  registerDocument('invoice', fixture('invoice.pdf'));
});

function session(name = 'simple.pdf') {
  const s = new EngineSession();
  s.open(fixture(name));
  return s;
}
const firstLine = (doc: mupdf.Document, i: number) =>
  doc.loadPage(i).toStructuredText('').asText().split('\n')[0];
const titles = (doc: mupdf.Document) =>
  Array.from({ length: doc.countPages() }, (_, i) => firstLine(doc, i));
const reopen = (s: EngineSession) => mupdf.Document.openDocument(s.save(), 'application/pdf');

describe('page ops', () => {
  it('reorders pages', () => {
    const s = session();
    const { changedPages } = s.setOps([{ kind: 'page.move', order: [2, 0, 1] }]);
    expect(titles(reopen(s))).toEqual(['Page 3', 'Page 1', 'Page 2']);
    expect(changedPages).toBe('all');
  });

  it('rejects an order that is not a permutation', () => {
    expect(() => session().setOps([{ kind: 'page.move', order: [0, 0, 1] }])).toThrow(OpError);
  });

  it('rotates pages clockwise, adding to the existing rotation', () => {
    const s = session('rotated.pdf'); // page 1 already /Rotate 90
    s.setOps([{ kind: 'page.rotate', pages: [0, 1], by: 90 }]);
    const doc = new mupdf.PDFDocument(s.save());
    expect(doc.findPage(0).get('Rotate').asNumber()).toBe(180);
    expect(doc.findPage(1).get('Rotate').asNumber()).toBe(90);
    s.setOps([
      { kind: 'page.rotate', pages: [0, 1], by: 90 },
      { kind: 'page.rotate', pages: [0], by: 180 },
    ]);
    expect(new mupdf.PDFDocument(s.save()).findPage(0).get('Rotate').asNumber()).toBe(0);
  });

  it('deletes pages and can undo it', () => {
    const s = session();
    s.setOps([{ kind: 'page.delete', pages: [0, 2] }]);
    expect(titles(s.doc)).toEqual(['Page 2']);
    s.setOps([]);
    expect(titles(s.doc)).toEqual(['Page 1', 'Page 2', 'Page 3']);
  });

  it('never deletes the last page', () => {
    expect(() => session().setOps([{ kind: 'page.delete', pages: [0, 1, 2] }])).toThrow(OpError);
  });

  it('inserts a blank page', () => {
    const s = session();
    s.setOps([{ kind: 'page.insertBlank', at: 1, width: 595, height: 842 }]);
    const doc = reopen(s);
    expect(doc.countPages()).toBe(4);
    expect(doc.loadPage(1).getBounds()).toEqual([0, 0, 595, 842]);
    expect(firstLine(doc, 2)).toBe('Page 2');
  });

  it('inserts pages from another PDF (merge)', () => {
    const s = session();
    s.setOps([{ kind: 'page.insertFrom', at: 3, source: 'invoice', pages: [0] }]);
    const doc = reopen(s);
    expect(doc.countPages()).toBe(4);
    expect(firstLine(doc, 3)).toBe('INVOICE');
  });

  it('rejects inserting from an unknown document', () => {
    expect(() =>
      session().setOps([{ kind: 'page.insertFrom', at: 0, source: 'nope', pages: [0] }]),
    ).toThrow(OpError);
  });

  it('keeps added objects with their page through moves', () => {
    const s = session();
    const ops: Op[] = [
      {
        kind: 'annot.add',
        id: 'n',
        page: 0,
        annot: { type: 'note', at: { x: 10, y: 10 }, text: 'on page 1', color: [1, 1, 0] },
      },
      { kind: 'page.move', order: [1, 2, 0] },
    ];
    s.setOps(ops);
    const doc = new mupdf.PDFDocument(s.save());
    expect(
      doc
        .loadPage(2)
        .getAnnotations()
        .map((a) => a.getContents()),
    ).toEqual(['on page 1']);
    expect(firstLine(doc, 2)).toBe('Page 1');
  });

  it('reports the new page sizes', () => {
    const s = session();
    s.setOps([{ kind: 'page.insertBlank', at: 0, width: 200, height: 100 }]);
    expect(s.pageInfo()[0]).toEqual({ index: 0, width: 200, height: 100 });
  });
});

describe('extract and split', () => {
  it('extracts selected pages into a new PDF without changing the open one', () => {
    const s = session();
    s.setOps([
      {
        kind: 'annot.add',
        id: 'n',
        page: 2,
        annot: { type: 'note', at: { x: 5, y: 5 }, text: 'kept', color: [1, 1, 0] },
      },
    ]);
    const out = mupdf.Document.openDocument(extractPages(s.doc, [2, 0]), 'application/pdf');
    expect(titles(out)).toEqual(['Page 3', 'Page 1']);
    expect((out as mupdf.PDFDocument).loadPage(0).getAnnotations()).toHaveLength(1);
    expect(s.doc.countPages()).toBe(3);
  });

  it('splits into ranges', () => {
    const s = session('100-pages.pdf');
    const parts = splitRanges(100, { every: 30 });
    expect(parts).toEqual([
      [0, 29],
      [30, 59],
      [60, 89],
      [90, 99],
    ]);
    const files = parts.map(([a, b]) => extractPages(s.doc, range(a, b)));
    expect(
      files.map((f) => mupdf.Document.openDocument(f, 'application/pdf').countPages()),
    ).toEqual([30, 30, 30, 10]);
  });

  it('parses custom ranges like "1-3, 5, 8-10"', () => {
    expect(splitRanges(10, { ranges: '1-3, 5, 8-10' })).toEqual([
      [0, 2],
      [4, 4],
      [7, 9],
    ]);
    expect(() => splitRanges(10, { ranges: '0-3' })).toThrow();
    expect(() => splitRanges(10, { ranges: '9-12' })).toThrow();
    expect(() => splitRanges(10, { ranges: 'abc' })).toThrow();
  });
});

describe('annotations travel with grafted pages', () => {
  it('merging keeps the inserted pages’ annotations', () => {
    const src = new EngineSession();
    src.open(fixture('simple.pdf'));
    src.setOps([
      {
        kind: 'annot.add',
        id: 'x',
        page: 0,
        annot: { type: 'note', at: { x: 5, y: 5 }, text: 'from source', color: [1, 1, 0] },
      },
    ]);
    registerDocument('annotated', src.save());
    const s = session('invoice.pdf');
    s.setOps([{ kind: 'page.insertFrom', at: 1, source: 'annotated', pages: [0] }]);
    const doc = new mupdf.PDFDocument(s.save());
    expect(
      doc
        .loadPage(1)
        .getAnnotations()
        .map((a) => a.getContents()),
    ).toEqual(['from source']);
    expect(doc.loadPage(0).getAnnotations()).toHaveLength(0);
  });
});
