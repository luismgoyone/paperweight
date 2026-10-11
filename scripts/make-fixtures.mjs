// Generates the synthetic PDF fixtures in tests/fixtures/ (no real personal data).
// Run with: npm run fixtures
import { mkdirSync, writeFileSync } from 'node:fs';
import * as mupdf from 'mupdf';

const out = new URL('../tests/fixtures/', import.meta.url);
mkdirSync(out, { recursive: true });

const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.';

function escapePdfString(s) {
  return s.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Builds a Letter-size PDF; `linesFor(i)` returns the text lines for page i (0-based). */
function makePdf(pageCount, linesFor) {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica'));
  for (let i = 0; i < pageCount; i++) {
    const [title, ...body] = linesFor(i);
    let content = `BT /F1 24 Tf 72 720 Td (${escapePdfString(title)}) Tj ET\n`;
    body.forEach((line, n) => {
      content += `BT /F1 11 Tf 72 ${680 - n * 16} Td (${escapePdfString(line)}) Tj ET\n`;
    });
    const resources = doc.addObject({ Font: { F1: font } });
    doc.insertPage(-1, doc.addPage([0, 0, 612, 792], 0, resources, content));
  }
  doc.setMetaData('info:Title', 'Fixture');
  return doc;
}

function write(name, bytes) {
  writeFileSync(new URL(name, out), bytes);
  console.log(`wrote tests/fixtures/${name} (${bytes.length} bytes)`);
}

const simple = makePdf(3, (i) => [
  `Page ${i + 1}`,
  LOREM,
  i === 0 ? 'Nothing to find here.' : 'The needle is somewhere in this haystack.',
  LOREM,
]);
write('simple.pdf', simple.saveToBuffer('garbage,compress').asUint8Array());

const hundred = makePdf(100, (i) => {
  const lines = [`Page ${i + 1}`];
  for (let n = 0; n < 30; n++) lines.push(`${n + 1}. ${LOREM}`);
  if ((i + 1) % 10 === 0) lines.push('This page mentions the invoice.');
  return lines;
});
write('100-pages.pdf', hundred.saveToBuffer('garbage,compress').asUint8Array());

write(
  'encrypted.pdf',
  simple
    .saveToBuffer('garbage,compress,encrypt=aes-256,user-password=secret,owner-password=owner')
    .asUint8Array(),
);

write('corrupt.pdf', new TextEncoder().encode('%PDF-1.7\nthis is not really a pdf\n'));
