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
});
