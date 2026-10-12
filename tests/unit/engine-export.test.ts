import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { renderPageRGBA } from '../../src/engine/render';
import type { Op } from '../../src/shared/types';
import { fixture } from './helpers';

const ops: Op[] = [
  {
    kind: 'annot.add',
    id: 'r1',
    page: 0,
    annot: {
      type: 'rect',
      rect: { x: 100, y: 100, w: 200, h: 100 },
      color: [1, 0, 0],
      fill: [0, 0, 1],
      width: 3,
      opacity: 1,
    },
  },
  {
    kind: 'annot.add',
    id: 'n1',
    page: 0,
    annot: { type: 'note', at: { x: 400, y: 100 }, text: 'Hi', color: [1, 1, 0] },
  },
];

function session() {
  const s = new EngineSession();
  s.open(fixture('simple.pdf'));
  s.setOps(ops);
  return s;
}

describe('save options', () => {
  it('keeps annotations editable by default', () => {
    const doc = new mupdf.PDFDocument(session().save());
    expect(doc.loadPage(0).getAnnotations()).toHaveLength(2);
  });

  it('flattens annotations into the page content', () => {
    const s = session();
    const editable = new mupdf.PDFDocument(s.save());
    const flat = new mupdf.PDFDocument(s.save({ flatten: true }));
    expect(flat.loadPage(0).getAnnotations()).toHaveLength(0);

    const a = renderPageRGBA(editable, 0, 0.5).pixels;
    const b = renderPageRGBA(flat, 0, 0.5).pixels;
    let different = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (
        Math.abs(a[i]! - b[i]!) +
          Math.abs(a[i + 1]! - b[i + 1]!) +
          Math.abs(a[i + 2]! - b[i + 2]!) >
        30
      )
        different++;
    }
    expect(different / (a.length / 4)).toBeLessThan(0.01);
  });

  it('does not change the live document when flattening', () => {
    const s = session();
    s.save({ flatten: true });
    expect(s.doc.loadPage(0).getAnnotations()).toHaveLength(2);
  });
});

describe('flattening a password-protected file', () => {
  it('stays encrypted and loses its annotations', () => {
    const s = new EngineSession();
    s.open(fixture('encrypted.pdf'), 'secret');
    s.setOps(ops);
    const flat = new mupdf.PDFDocument(s.save({ flatten: true }));
    expect(flat.needsPassword()).toBe(true);
    expect(flat.authenticatePassword('secret')).toBeGreaterThan(0);
    expect(flat.loadPage(0).getAnnotations()).toHaveLength(0);
  });
});
