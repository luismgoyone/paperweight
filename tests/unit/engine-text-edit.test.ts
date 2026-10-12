import { readFileSync } from 'node:fs';
import * as mupdf from 'mupdf';
import { beforeAll, describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { registerFont } from '../../src/engine/fonts';
import { OpError } from '../../src/engine/ops';
import { textEditInfo } from '../../src/engine/ops/text-edit';
import { renderPageRGBA } from '../../src/engine/render';
import { textRuns } from '../../src/engine/text';
import { ALL_FONTS, firstBaselineOffset, fontFile, fontId } from '../../src/shared/fonts';
import type { Op, Rect, TextRun, TextSpec } from '../../src/shared/types';
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

function session(name: string) {
  const s = new EngineSession();
  s.open(fixture(name));
  return s;
}

const amountRun = (runs: TextRun[], text: string) =>
  runs.filter((r) => r.text === text).sort((a, b) => b.x1 - a.x1)[0];

/** What the UI sends: the replacement keeps the run's baseline and (for numbers) right edge. */
function editOp(id: string, run: TextRun, text: string, anchor: 'left' | 'right' = 'right'): Op {
  const family = 'Liberation Sans' as const;
  const spec: TextSpec = {
    text,
    box: {
      x: anchor === 'right' ? run.x1 - 40 : run.x0,
      y: run.baseline - firstBaselineOffset(family, run.size),
      w: 40,
      h: run.size * 1.2,
    },
    style: {
      family,
      size: run.size,
      color: run.color,
      align: anchor,
      bold: false,
      italic: false,
      original: { fontName: run.font },
    },
  };
  return { kind: 'text.edit', id, page: 0, target: { text: run.text, bbox: run.bbox }, spec };
}

describe('text.edit (success criterion 1)', () => {
  it('changes $26 to $31 in place: same font, size, color, baseline and right edge', () => {
    const s = session('invoice.pdf');
    const before = amountRun(textRuns(s.doc, 0), '$26')!;
    s.setOps([editOp('e1', before, '$31')]);

    const saved = mupdf.Document.openDocument(s.save(), 'application/pdf');
    const runs = textRuns(saved, 0);
    const after = runs.find((r) => r.text === '$31')!;
    expect(after).toBeDefined();
    expect(Math.abs(after.x1 - before.x1)).toBeLessThan(0.5);
    expect(Math.abs(after.baseline - before.baseline)).toBeLessThan(0.1);
    expect(after.size).toBeCloseTo(before.size, 2);
    expect(after.color).toEqual(before.color);
    expect(textEditInfo('e1')).toMatchObject({ usedOriginal: true });
    // Only that run changed: the Rate column still says $26.
    expect(runs.filter((r) => r.text === '$26')).toHaveLength(1);
  });

  it('looks like an invoice that always said $31 (golden render)', () => {
    const s = session('invoice.pdf');
    s.setOps([editOp('e1', amountRun(textRuns(s.doc, 0), '$26')!, '$31')]);
    const edited = renderPageRGBA(
      mupdf.Document.openDocument(s.save(), 'application/pdf'),
      0,
      2,
    ).pixels;
    const reference = renderPageRGBA(
      mupdf.Document.openDocument(fixture('invoice-31.pdf'), 'application/pdf'),
      0,
      2,
    ).pixels;
    let different = 0;
    for (let i = 0; i < edited.length; i += 4) {
      const d =
        Math.abs(edited[i]! - reference[i]!) +
        Math.abs(edited[i + 1]! - reference[i + 1]!) +
        Math.abs(edited[i + 2]! - reference[i + 2]!);
      if (d > 60) different++;
    }
    // No white box, no ghost of the old glyphs, nothing shifted.
    expect(different).toBeLessThan(20);
  });

  it('can be edited again (text.update) and undone', () => {
    const s = session('invoice.pdf');
    const run = amountRun(textRuns(s.doc, 0), '$26')!;
    const edit = editOp('e1', run, '$31') as Extract<Op, { kind: 'text.edit' }>;
    s.setOps([
      edit,
      { kind: 'text.update', id: 'e1', page: 0, spec: { ...edit.spec, text: '$35' } },
    ]);
    expect(textRuns(s.doc, 0).map((r) => r.text)).toContain('$35');
    s.setOps([]);
    expect(textRuns(s.doc, 0).filter((r) => r.text === '$26')).toHaveLength(2);
  });

  it('rejects an edit whose run no longer exists, leaving the page unchanged', () => {
    const s = session('invoice.pdf');
    const run = amountRun(textRuns(s.doc, 0), '$26')!;
    const ghost = { ...run, text: '$99' };
    expect(() => s.setOps([editOp('e1', ghost, '$31')])).toThrow(OpError);
    expect(textRuns(s.doc, 0).filter((r) => r.text === '$26')).toHaveLength(2);
  });
});

describe('text.edit with a subset font (spec §4 cases 1 and 2)', () => {
  const run = (s: EngineSession) => textRuns(s.doc, 0)[0]!; // "Total $26"

  it('reuses the embedded subset when it has every glyph', () => {
    const s = session('subset-font.pdf');
    const r = run(s);
    s.setOps([editOp('e1', r, 'Total $62', 'left')]);
    const after = textRuns(mupdf.Document.openDocument(s.save(), 'application/pdf'), 0)[0]!;
    expect(after.text).toBe('Total $62');
    expect(after.font).toMatch(/LiberationSans/);
    expect(textEditInfo('e1')).toMatchObject({ usedOriginal: true });
  });

  it('falls back to the bundled family when the subset lacks a glyph, and reports it', () => {
    const s = session('subset-font.pdf');
    const r = run(s);
    s.setOps([editOp('e1', r, 'Total $31', 'left')]);
    const after = textRuns(mupdf.Document.openDocument(s.save(), 'application/pdf'), 0)[0]!;
    expect(after.text).toBe('Total $31');
    expect(Math.abs(after.x0 - r.x0)).toBeLessThan(0.5);
    expect(Math.abs(after.baseline - r.baseline)).toBeLessThan(0.1);
    expect(textEditInfo('e1')).toEqual({
      fontName: r.font,
      usedOriginal: false,
      substitute: 'Liberation Sans',
    });
  });
});

void (0 as unknown as Rect);
