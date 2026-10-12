import { readFileSync } from 'node:fs';
import * as mupdf from 'mupdf';
import { beforeAll, describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { registerFont } from '../../src/engine/fonts';
import { renderPageRGBA } from '../../src/engine/render';
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

function session(bytes: Uint8Array) {
  const s = new EngineSession();
  s.open(bytes);
  return s;
}

// "Monthly hosting" row: y 186..198 on the invoice; the amount column x 520..541.
const amountRow = { x: 515, y: 186, w: 30, h: 13 };

describe('redact', () => {
  it('removes the text under the area for good and keeps the rest', () => {
    const s = session(fixture('invoice.pdf'));
    s.setOps([{ kind: 'redact', page: 0, rects: [amountRow] }]);
    const saved = new mupdf.PDFDocument(s.save());
    const runs = textRuns(saved, 0);
    expect(runs.filter((r) => r.text === '$26')).toHaveLength(1); // only the Rate column's
    expect(runs.map((r) => r.text)).toContain('Monthly hosting');
    // Not just covered: the bytes of the page no longer contain the string.
    expect(saved.loadPage(0).getObject().get('Contents').readStream().asString()).not.toMatch(
      /\$26\)[^]*\$26\)/,
    );
  });

  it('draws a black box over the area', () => {
    const s = session(fixture('invoice.pdf'));
    s.setOps([{ kind: 'redact', page: 0, rects: [amountRow] }]);
    const { pixels, width } = renderPageRGBA(new mupdf.PDFDocument(s.save()), 0, 1);
    const i = (192 * width + 530) * 4;
    expect([...pixels.slice(i, i + 3)]).toEqual([0, 0, 0]);
  });

  it('removes image pixels under the area', () => {
    // A white page with a solid red image covering it.
    const doc = new mupdf.PDFDocument();
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 100, 100], false);
    const px = pix.getPixels();
    for (let i = 0; i < px.length; i += 3) [px[i], px[i + 1], px[i + 2]] = [255, 0, 0];
    const img = doc.addImage(new mupdf.Image(pix));
    doc.insertPage(
      -1,
      doc.addPage(
        [0, 0, 200, 200],
        0,
        doc.addObject({ XObject: { Im: img } }),
        'q 200 0 0 200 0 0 cm /Im Do Q',
      ),
    );
    const s = session(doc.saveToBuffer('').asUint8Array().slice());
    s.setOps([{ kind: 'redact', page: 0, rects: [{ x: 0, y: 0, w: 100, h: 200 }] }]);
    // Even with the black box gone (rendering only the image), the left half has no red left.
    const saved = new mupdf.PDFDocument(s.save());
    // Redaction may rename the image resource: take the page's (only) image.
    let xobject: mupdf.PDFObject | null = null;
    saved
      .findPage(0)
      .get('Resources', 'XObject')
      .forEach((v) => (xobject ??= v));
    const image = saved.loadImage(xobject!).toPixmap();
    const ip = image.getPixels();
    const n = image.getNumberOfComponents();
    const at = (x: number, y: number) => [
      ...ip.slice((y * image.getWidth() + x) * n, (y * image.getWidth() + x) * n + 3),
    ];
    expect(at(10, 50)).not.toEqual([255, 0, 0]);
    expect(at(90, 50)).toEqual([255, 0, 0]);
  });

  it('removes annotations and form values in the area', () => {
    const s = session(fixture('form.pdf'));
    s.setOps([
      { kind: 'form.set', field: 'name', value: 'Secret Name' },
      {
        kind: 'annot.add',
        id: 'n',
        page: 0,
        annot: { type: 'note', at: { x: 200, y: 60 }, text: 'secret note', color: [1, 1, 0] },
      },
      { kind: 'redact', page: 0, rects: [{ x: 170, y: 55, w: 240, h: 30 }] },
    ]);
    const saved = new mupdf.PDFDocument(s.save());
    const bytes = new TextDecoder('latin1').decode(s.save());
    expect(
      saved
        .loadPage(0)
        .getAnnotations()
        .map((a) => a.getContents()),
    ).not.toContain('secret note');
    expect(
      saved
        .loadPage(0)
        .getWidgets()
        .map((w) => w.getName()),
    ).not.toContain('name');
    expect(bytes).not.toContain('Secret Name');
  });

  it('keeps added text elsewhere editable, and undo restores the page', () => {
    const s = session(fixture('invoice.pdf'));
    const spec: TextSpec = {
      box: { x: 100, y: 400, w: 200, h: 14 },
      text: 'Added',
      style: {
        family: 'Liberation Sans',
        size: 10,
        color: [0, 0, 0],
        align: 'left',
        bold: false,
        italic: false,
      },
    };
    const ops: Op[] = [
      { kind: 'text.add', id: 't', page: 0, spec },
      { kind: 'redact', page: 0, rects: [amountRow] },
      { kind: 'text.update', id: 't', page: 0, spec: { ...spec, text: 'Updated' } },
    ];
    s.setOps(ops);
    expect(textRuns(s.doc, 0).map((r) => r.text)).toContain('Updated');
    s.setOps(ops.slice(0, 1));
    expect(textRuns(s.doc, 0).filter((r) => r.text === '$26')).toHaveLength(2);
    // The checkpoint taken just before the redaction (after op 1) is still valid.
    expect(s.checkpointIndices).toEqual([1]);
  });
});
