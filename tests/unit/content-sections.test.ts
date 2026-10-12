import { readFileSync } from 'node:fs';
import * as mupdf from 'mupdf';
import { beforeAll, describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { registerFont } from '../../src/engine/fonts';
import { textRuns } from '../../src/engine/text';
import { ALL_FONTS, fontFile, fontId } from '../../src/shared/fonts';
import type { Op, TextSpec } from '../../src/shared/types';
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

const spec = (text: string, y: number): TextSpec => ({
  box: { x: 100, y, w: 200, h: 14 },
  text,
  style: {
    family: 'Liberation Sans',
    size: 10,
    color: [0, 0, 0],
    align: 'left',
    bold: false,
    italic: false,
  },
});

/** Applies a text-only redaction on page 0 over a rect, like Phase 5 edits do. */
function redact(s: EngineSession, rect: mupdf.Rect) {
  const page = s.doc.loadPage(0);
  const annot = page.createAnnotation('Redact');
  annot.setRect(rect);
  annot.update();
  page.applyRedactions(false, 0, 0, 0);
}

describe('added objects survive the page being rewritten by a redaction', () => {
  it('text.update and text.delete still find their object', () => {
    const s = new EngineSession();
    s.open(fixture('invoice.pdf'));
    const ops: Op[] = [
      { kind: 'text.add', id: 'a', page: 0, spec: spec('Alpha', 400) },
      { kind: 'text.add', id: 'b', page: 0, spec: spec('Beta', 450) },
    ];
    s.setOps(ops);
    // Merges the page content into one stream, drops comments, re-serializes operators.
    redact(s, [500, 185, 545, 200]); // over the amount "$26"
    const texts = () => textRuns(s.doc, 0).map((r) => r.text);
    expect(texts()).toEqual(expect.arrayContaining(['Alpha', 'Beta']));

    s.setOps([...ops, { kind: 'text.update', id: 'a', page: 0, spec: spec('Alpha 2', 400) }]);
    expect(texts()).toContain('Alpha 2');
    expect(texts()).not.toContain('Alpha');
    expect(texts()).toContain('Beta');

    s.setOps([
      ...ops,
      { kind: 'text.update', id: 'a', page: 0, spec: spec('Alpha 2', 400) },
      { kind: 'text.delete', id: 'b', page: 0 },
    ]);
    expect(texts()).toContain('Alpha 2');
    expect(texts()).not.toContain('Beta');
    expect(texts()).toContain('INVOICE');
  });
});
