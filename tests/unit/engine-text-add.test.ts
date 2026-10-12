import { readFileSync } from 'node:fs';
import * as mupdf from 'mupdf';
import { beforeAll, describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { registerFont } from '../../src/engine/fonts';
import { OpError } from '../../src/engine/ops';
import { textRuns } from '../../src/engine/text';
import { ALL_FONTS, firstBaselineOffset, fontFile, fontId } from '../../src/shared/fonts';
import type { Op, TextSpec, TextStyle } from '../../src/shared/types';
import { fixture } from './helpers';

beforeAll(() => {
  for (const f of ALL_FONTS) {
    registerFont(
      fontId(f.family, f),
      new Uint8Array(
        readFileSync(new URL(`../../public/${fontFile(f.family, f)}`, import.meta.url)),
      ),
    );
  }
});

const style: TextStyle = {
  family: 'Liberation Sans',
  size: 10,
  color: [0.8, 0, 0],
  align: 'left',
  bold: false,
  italic: false,
};

function session(name = 'invoice.pdf') {
  const s = new EngineSession();
  s.open(fixture(name));
  return s;
}

const addText = (id: string, spec: TextSpec, page = 0): Op => ({
  kind: 'text.add',
  id,
  page,
  spec,
});

function runsAfterSave(s: EngineSession, page = 0) {
  return textRuns(mupdf.Document.openDocument(s.save(), 'application/pdf'), page);
}

describe('text.add', () => {
  it('draws text at the box position, baseline, size, font and color', () => {
    const s = session();
    const box = { x: 300, y: 300, w: 100, h: 14 };
    s.setOps([addText('t1', { box, text: 'Paid in full', style })]);
    const run = runsAfterSave(s).find((r) => r.text === 'Paid in full')!;
    expect(run).toBeDefined();
    expect(run.x0).toBeCloseTo(300, 0);
    expect(run.baseline).toBeCloseTo(300 + firstBaselineOffset('Liberation Sans', 10), 1);
    expect(run.size).toBeCloseTo(10, 2);
    expect(run.font).toMatch(/LiberationSans/);
    expect(run.color.map((c) => Math.round(c * 10) / 10)).toEqual([0.8, 0, 0]);
  });

  it('right-aligns to the box edge within 0.5 pt (success criterion 2)', () => {
    const s = session();
    const box = { x: 440, y: 150, w: 100, h: 14 };
    s.setOps([addText('t1', { box, text: '$31', style: { ...style, align: 'right' } })]);
    const run = runsAfterSave(s).find((r) => r.text === '$31')!;
    expect(Math.abs(run.x1 - 540)).toBeLessThan(0.5);
  });

  it('centers within the box', () => {
    const s = session();
    s.setOps([
      addText('t1', {
        box: { x: 100, y: 300, w: 200, h: 14 },
        text: 'Mid',
        style: { ...style, align: 'center' },
      }),
    ]);
    const run = runsAfterSave(s).find((r) => r.text === 'Mid')!;
    expect((run.x0 + run.x1) / 2).toBeCloseTo(200, 0);
  });

  it('lays out multiple lines at 1.2 line height', () => {
    const s = session();
    s.setOps([addText('t1', { box: { x: 100, y: 300, w: 200, h: 30 }, text: 'One\nTwo', style })]);
    const runs = runsAfterSave(s);
    const one = runs.find((r) => r.text === 'One')!;
    const two = runs.find((r) => r.text === 'Two')!;
    expect(two.baseline - one.baseline).toBeCloseTo(12, 1);
  });

  it('uses bold and italic font files', () => {
    const s = session();
    s.setOps([
      addText('t1', {
        box: { x: 100, y: 300, w: 200, h: 14 },
        text: 'Strong',
        style: { ...style, bold: true, italic: true },
      }),
    ]);
    expect(runsAfterSave(s).find((r) => r.text === 'Strong')!.font).toMatch(/BoldItalic/);
  });

  it('updates and deletes by id; undo restores', () => {
    const s = session();
    const spec: TextSpec = { box: { x: 100, y: 300, w: 200, h: 14 }, text: 'First', style };
    const ops: Op[] = [
      addText('t1', spec),
      {
        kind: 'text.update',
        id: 't1',
        page: 0,
        spec: { ...spec, text: 'Second', box: { ...spec.box, x: 150 } },
      },
      { kind: 'text.delete', id: 't1', page: 0 },
    ];
    const live = () => textRuns(s.doc, 0).map((r) => r.text);
    s.setOps(ops.slice(0, 2));
    expect(live()).toContain('Second');
    expect(live()).not.toContain('First');
    s.setOps(ops);
    expect(live()).not.toContain('Second');
    s.setOps(ops.slice(0, 1));
    expect(live()).toContain('First');
  });

  it('leaves the original page content untouched', () => {
    const s = session();
    s.setOps([addText('t1', { box: { x: 100, y: 300, w: 200, h: 14 }, text: 'Extra', style })]);
    const texts = runsAfterSave(s).map((r) => r.text);
    expect(texts).toContain('$26');
    expect(texts).toContain('INVOICE');
  });

  it('rejects characters the font cannot display, leaving the document unchanged', () => {
    const s = session();
    expect(() =>
      s.setOps([addText('t1', { box: { x: 100, y: 300, w: 200, h: 14 }, text: 'Hi 😀', style })]),
    ).toThrow(OpError);
    expect(textRuns(s.doc, 0).map((r) => r.text)).not.toContain('Hi');
  });

  it('positions text in page space on rotated and offset pages', () => {
    for (const page of [0, 1]) {
      const s = session('rotated.pdf');
      s.setOps([
        addText('t1', { box: { x: 60, y: 80, w: 200, h: 14 }, text: 'Placed', style }, page),
      ]);
      const run = runsAfterSave(s, page).find((r) => r.text === 'Placed')!;
      expect(run.x0).toBeCloseTo(60, 0);
      expect(run.baseline).toBeCloseTo(80 + firstBaselineOffset('Liberation Sans', 10), 0);
    }
  });
});

describe('pages that share content', () => {
  it('adding text to one page never changes another page sharing its /Contents array', () => {
    // Build a two-page PDF whose pages point at the same indirect Contents array.
    const doc = new mupdf.PDFDocument();
    const font = doc.addSimpleFont(new mupdf.Font('Helvetica'));
    const resources = doc.addObject({ Font: { F1: font } });
    const stream = doc.addStream('BT /F1 12 Tf 72 720 Td (Shared) Tj ET', {});
    const contents = doc.addObject(doc.newArray());
    contents.push(stream);
    for (let i = 0; i < 2; i++) {
      const page = doc.addPage([0, 0, 612, 792], 0, resources, '');
      page.put('Contents', contents);
      doc.insertPage(-1, page);
    }
    const s = new EngineSession();
    s.open(doc.saveToBuffer('').asUint8Array().slice());
    s.setOps([addText('t1', { box: { x: 100, y: 300, w: 200, h: 14 }, text: 'Only page one', style })]);
    s.setOps([
      addText('t1', { box: { x: 100, y: 300, w: 200, h: 14 }, text: 'Only page one', style }),
      { kind: 'text.delete', id: 't1', page: 0 },
      addText('t2', { box: { x: 100, y: 300, w: 200, h: 14 }, text: 'Again', style }),
    ]);
    const saved = mupdf.Document.openDocument(s.save(), 'application/pdf');
    expect(textRuns(saved, 0).map((r) => r.text)).toEqual(['Shared', 'Again']);
    expect(textRuns(saved, 1).map((r) => r.text)).toEqual(['Shared']);
  });
});
