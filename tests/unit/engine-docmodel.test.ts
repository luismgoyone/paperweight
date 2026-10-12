import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';
import { documentModel } from '../../src/engine/docmodel';
import type { DocBlock, DocRun } from '../../src/shared/types';
import { fixture } from './helpers';

const open = (bytes: Uint8Array) => mupdf.Document.openDocument(bytes, 'application/pdf');
const text = (runs: DocRun[]) => runs.map((r) => r.text).join('');
const paragraphs = (blocks: DocBlock[]) =>
  blocks.flatMap((b) => (b.kind === 'paragraph' ? [b] : []));

function pdf(content: string, fonts: Record<string, string> = { F1: 'Helvetica' }): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const dict: Record<string, mupdf.PDFObject> = {};
  for (const [k, v] of Object.entries(fonts)) dict[k] = doc.addSimpleFont(new mupdf.Font(v));
  doc.insertPage(-1, doc.addPage([0, 0, 612, 792], 0, doc.addObject({ Font: dict }), content));
  return doc.saveToBuffer('').asUint8Array().slice();
}

describe('documentModel', () => {
  it('turns the invoice line items into a table with a bold header', () => {
    const [page] = documentModel(open(fixture('invoice.pdf')));
    const table = page!.blocks.find((b) => b.kind === 'table');
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') return;
    expect(table.rows[0]!.map(text)).toEqual(['Description', 'Qty', 'Rate', 'Amount']);
    expect(table.rows[0]![0]![0]!.bold).toBe(true);
    expect(table.rows[1]!.map(text)).toEqual(['Monthly hosting', '1', '$26', '$26']);
    expect(table.rows.length).toBeGreaterThanOrEqual(4);
    const title = paragraphs(page!.blocks)[0]!;
    expect(text(title.runs)).toBe('INVOICE');
    expect(title.runs[0]!.bold).toBe(true);
    expect(title.runs[0]!.size).toBeCloseTo(22, 0);
    // The table's text isn't repeated as paragraphs.
    expect(paragraphs(page!.blocks).some((p) => text(p.runs).includes('Monthly hosting'))).toBe(
      false,
    );
  });

  it('keeps reading order and page size', () => {
    const [page] = documentModel(open(fixture('simple.pdf')));
    expect(page!.width).toBe(612);
    expect(page!.height).toBe(792);
    const texts = paragraphs(page!.blocks).map((p) => text(p.runs));
    expect(texts[0]).toBe('Page 1');
    expect(texts.some((t) => t.includes('Lorem ipsum'))).toBe(true);
  });

  it('detects centered text', () => {
    const font = new mupdf.Font('Helvetica');
    const title = 'Centered Title';
    const w = [...title].reduce((a, c) => a + font.advanceGlyph(font.encodeCharacter(c)) * 18, 0);
    const [page] = documentModel(
      open(
        pdf(
          `BT /F1 18 Tf ${(612 - w) / 2} 700 Td (${title}) Tj ET\nBT /F1 11 Tf 72 650 Td (Body text on the left margin.) Tj ET`,
        ),
      ),
    );
    const ps = paragraphs(page!.blocks);
    expect(ps[0]!.align).toBe('center');
    expect(ps[1]!.align).toBe('left');
  });

  it('joins wrapped lines into one paragraph and rejoins hyphenated words', () => {
    const [page] = documentModel(
      open(
        pdf(
          'BT /F1 11 Tf 72 700 Td (A paragraph that wraps onto a sec-) Tj ET\nBT /F1 11 Tf 72 687 Td (ond line of text.) Tj ET\nBT /F1 11 Tf 72 640 Td (Next paragraph.) Tj ET',
        ),
      ),
    );
    const texts = paragraphs(page!.blocks).map((p) => text(p.runs));
    expect(texts).toEqual([
      'A paragraph that wraps onto a second line of text.',
      'Next paragraph.',
    ]);
  });

  it('includes images with their displayed size', () => {
    const [page] = documentModel(open(fixture('scanned.pdf')));
    const image = page!.blocks.find((b) => b.kind === 'image');
    expect(image?.kind).toBe('image');
    if (image?.kind !== 'image') return;
    expect(new TextDecoder('latin1').decode(image.png.slice(1, 4))).toBe('PNG');
    expect(image.width).toBeCloseTo(612, 0);
  });
});
