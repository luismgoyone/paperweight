import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { registerFont } from '../../src/engine/fonts';
import { renderPageRGBA, searchDocument } from '../../src/engine/render';
import { textRuns } from '../../src/engine/text';
import { ALL_FONTS, fontFile, fontId } from '../../src/shared/fonts';
import type { Op } from '../../src/shared/types';
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

// Roughly where the scanned fixture's first line ("Scanned invoice", 28 pt) is.
const words = [
  { text: 'Scanned', bbox: { x: 72, y: 72, w: 116, h: 28 } },
  { text: 'invoice', bbox: { x: 196, y: 72, w: 88, h: 28 } },
];
const ocr: Op = { kind: 'ocr.addLayer', id: 'ocr0', page: 0, words };

describe('ocr.addLayer', () => {
  it('makes a scanned page searchable without changing how it looks', () => {
    const s = new EngineSession();
    s.open(fixture('scanned.pdf'));
    expect(textRuns(s.doc, 0)).toEqual([]);
    const before = renderPageRGBA(s.doc, 0, 0.5).pixels;
    s.setOps([ocr]);
    const hits = searchDocument(s.doc, 'invoice');
    expect(hits).toHaveLength(1);
    const r = hits[0]!.rects[0]!;
    expect(r.x).toBeCloseTo(196, -1);
    expect(r.x + r.w).toBeCloseTo(284, -1);
    const after = renderPageRGBA(s.doc, 0, 0.5).pixels;
    let different = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) different++;
    expect(different).toBe(0);
  });

  it('skips words the font cannot draw instead of failing', () => {
    const s = new EngineSession();
    s.open(fixture('scanned.pdf'));
    s.setOps([
      { ...ocr, words: [...words, { text: '😀', bbox: { x: 300, y: 72, w: 20, h: 20 } }] } as Op,
    ]);
    expect(searchDocument(s.doc, 'Scanned')).toHaveLength(1);
  });

  it('undoes', () => {
    const s = new EngineSession();
    s.open(fixture('scanned.pdf'));
    s.setOps([ocr]);
    s.setOps([]);
    expect(textRuns(s.doc, 0)).toEqual([]);
  });
});
