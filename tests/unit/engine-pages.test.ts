import * as mupdf from 'mupdf';
import { beforeAll, describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { registerDocument } from '../../src/engine/documents';
import { extractPages as extractFrom } from '../../src/engine/export';
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
    const out = mupdf.Document.openDocument(s.extract([2, 0]), 'application/pdf');
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
    const files = parts.map(([a, b]) => s.extract(range(a, b)));
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

/** Every object in the file that is a /Type /Page (visible or not). */
function pageObjects(doc: mupdf.PDFDocument): number {
  let n = 0;
  for (let i = 1; i < doc.countObjects(); i++) {
    const obj = doc.newIndirect(i).resolve();
    if (obj.isDictionary() && obj.get('Type').isName() && obj.get('Type').asName() === 'Page') n++;
  }
  return n;
}

/** All text of every content stream in the file, decompressed. */
function allStreamText(doc: mupdf.PDFDocument): string {
  let out = '';
  for (let i = 1; i < doc.countObjects(); i++) {
    const obj = doc.newIndirect(i);
    if (obj.isStream()) out += obj.readStream().asString();
  }
  return out;
}

/** simple.pdf with a link on page 1 that goes to page 3, plus a URL link. */
function linkedSource(): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument(fixture('simple.pdf'));
  const page = doc.findPage(0);
  const goTo = doc.addObject({
    Type: doc.newName('Annot'),
    Subtype: doc.newName('Link'),
    Rect: [72, 600, 200, 620],
    Dest: [doc.findPage(2), doc.newName('XYZ'), 0, 792, 0],
    P: page,
  });
  const uri = doc.addObject({
    Type: doc.newName('Annot'),
    Subtype: doc.newName('Link'),
    Rect: [72, 560, 200, 580],
    A: { S: doc.newName('URI'), URI: doc.newString('https://example.com') },
    P: page,
  });
  const annots = doc.newArray();
  annots.push(goTo);
  annots.push(uri);
  page.put('Annots', annots);
  return new mupdf.PDFDocument(doc.saveToBuffer('').asUint8Array().slice());
}

describe('grafting never drags other pages along (privacy)', () => {
  it('extracting one page with a link to another page carries no other page', () => {
    const out = new mupdf.PDFDocument(extractFrom(linkedSource(), [0]));
    expect(out.countPages()).toBe(1);
    expect(pageObjects(out)).toBe(1);
    const text = allStreamText(out);
    expect(text).toContain('Page 1');
    expect(text).not.toContain('Page 2');
    expect(text).not.toContain('Page 3');
    // The internal link pointed outside the extracted pages, so it's dropped; the URL link stays.
    const links = out.loadPage(0).getObject().get('Annots');
    expect(links.length).toBe(1);
    expect(links.get(0).get('A', 'URI').asString()).toBe('https://example.com');
  });

  it('keeps internal links between pages that are extracted together, retargeted', () => {
    const out = new mupdf.PDFDocument(extractFrom(linkedSource(), [2, 0]));
    expect(pageObjects(out)).toBe(2);
    const link = out.findPage(1).get('Annots').get(0);
    // Page 3 of the source is page 1 of the output.
    expect(link.get('Dest').get(0).asIndirect()).toBe(out.findPage(0).asIndirect());
  });

  it('merging a page does not copy the rest of the source document', () => {
    registerDocument('linked', linkedSource().saveToBuffer('').asUint8Array().slice());
    const s = session('invoice.pdf');
    s.setOps([{ kind: 'page.insertFrom', at: 1, source: 'linked', pages: [0] }]);
    const doc = new mupdf.PDFDocument(s.save());
    expect(doc.countPages()).toBe(2);
    expect(pageObjects(doc)).toBe(2);
    expect(allStreamText(doc)).not.toContain('Page 3');
  });
});

describe('merged form fields', () => {
  it('stay fillable, get unique names when inserted twice, and the document reports a form', () => {
    registerDocument('form', fixture('form.pdf'));
    const s = session();
    s.setOps([
      { kind: 'page.insertFrom', at: 3, source: 'form', pages: [0] },
      { kind: 'page.insertFrom', at: 4, source: 'form', pages: [0] },
      { kind: 'form.set', field: 'name', value: 'First copy' },
      { kind: 'form.set', field: 'name (2)', value: 'Second copy' },
    ]);
    const doc = new mupdf.PDFDocument(s.save());
    const names = (i: number) =>
      doc
        .loadPage(i)
        .getWidgets()
        .map((w) => w.getName());
    expect(names(3)).toContain('name');
    expect(names(4)).toContain('name (2)');
    const value = (i: number, n: string) =>
      doc
        .loadPage(i)
        .getWidgets()
        .find((w) => w.getName() === n)!
        .getValue();
    expect(value(3, 'name')).toBe('First copy');
    expect(value(4, 'name (2)')).toBe('Second copy');
    expect(s.hasForm()).toBe(true);
  });
});

describe('extract from a protected file', () => {
  it('keeps the password on the extracted file', () => {
    const s = new EngineSession();
    s.open(fixture('encrypted.pdf'), 'secret');
    const out = mupdf.Document.openDocument(s.extract([0]), 'application/pdf');
    expect(out.needsPassword()).toBe(true);
    expect(out.authenticatePassword('secret')).toBeGreaterThan(0);
  });
});
