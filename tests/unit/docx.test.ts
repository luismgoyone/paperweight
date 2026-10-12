import JSZip from 'jszip';
import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';
import { buildDocx } from '../../src/editor/docx';
import { documentModel } from '../../src/engine/docmodel';
import { fixture } from './helpers';

async function documentXml(bytes: ArrayBuffer | Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  return { zip, xml: await zip.file('word/document.xml')!.async('string') };
}

describe('buildDocx', () => {
  it('writes paragraphs and a table for the invoice', async () => {
    const model = documentModel(
      mupdf.Document.openDocument(fixture('invoice.pdf'), 'application/pdf'),
    );
    const blob = await buildDocx(model);
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const { xml } = await documentXml(await blob.arrayBuffer());
    expect(xml).toContain('INVOICE');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('Monthly hosting');
    expect(xml).toContain('<w:b/>'); // bold header / title
    // Letter page size in twips.
    expect(xml).toMatch(/w:pgSz[^>]*w:w="12240"[^>]*w:h="15840"/);
  });

  it('embeds images', async () => {
    const model = documentModel(
      mupdf.Document.openDocument(fixture('scanned.pdf'), 'application/pdf'),
    );
    const { zip } = await documentXml(await (await buildDocx(model)).arrayBuffer());
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true);
  });

  it('puts each PDF page on its own page', async () => {
    const model = documentModel(
      mupdf.Document.openDocument(fixture('simple.pdf'), 'application/pdf'),
    );
    const { xml } = await documentXml(await (await buildDocx(model)).arrayBuffer());
    expect(xml.match(/<w:sectPr/g)!.length).toBe(3);
  });

  const run = (text: string, size = 11) => ({
    text,
    size,
    bold: false,
    italic: false,
    color: [0, 0, 0] as [number, number, number],
  });

  it('drops characters XML cannot carry, so Word can open the file', async () => {
    const { xml } = await documentXml(
      await (
        await buildDocx([
          {
            width: 612,
            height: 792,
            blocks: [
              {
                kind: 'paragraph',
                align: 'left',
                spaceBefore: 0,
                runs: [run('a\u0001b\u0003c￾d\uD800')],
              },
              {
                kind: 'paragraph',
                align: 'left',
                spaceBefore: 0,
                runs: [run('\u0002'), run('ok', 0)],
              },
              { kind: 'table', rows: [[[run('x\u001Fy')], [run('z')]]] },
            ],
          },
        ])
      ).arrayBuffer(),
    );
    expect(xml).toContain('abcd');
    expect(xml).toContain('xy');
    // eslint-disable-next-line no-control-regex
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿\uD800-\uDFFF]/);
    expect(xml).not.toContain('w:val="0"/>');
  });

  it('writes landscape pages as landscape and fits images in the page', async () => {
    const png = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 10, 10], false);
    png.clear(255);
    const { xml } = await documentXml(
      await (
        await buildDocx([
          {
            width: 792,
            height: 612,
            blocks: [{ kind: 'image', png: png.asPNG(), width: 792, height: 612 }],
          },
          {
            width: 72,
            height: 72,
            blocks: [{ kind: 'paragraph', align: 'left', spaceBefore: 0, runs: [run('tiny')] }],
          },
          { width: 5000, height: 5000, blocks: [] },
        ])
      ).arrayBuffer(),
    );
    expect(xml).toMatch(/w:pgSz[^>]*w:w="15840"[^>]*w:h="12240"[^>]*w:orient="landscape"/);
    // The image is no larger than the content box: (792 - 2·36) × (612 - 2·36) points, in EMU.
    const extent = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"/)!;
    expect(Number(extent[1])).toBeLessThanOrEqual(720 * 12700);
    expect(Number(extent[2])).toBeLessThanOrEqual(540 * 12700);
    // Small pages keep room for content; huge pages are clamped to Word's 22-inch limit.
    const sizes = [...xml.matchAll(/<w:pgSz [^>]*w:w="(\d+)"[^>]*w:h="(\d+)"/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(sizes[2]).toEqual([31680, 31680]);
    const margins = [...xml.matchAll(/<w:pgMar [^>]*w:left="(\d+)"/g)].map((m) => Number(m[1]));
    expect(margins[1]).toBeLessThan(720);
  });
});
