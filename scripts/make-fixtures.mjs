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

// A recreated invoice (spec §9): Helvetica, right-aligned amount column, no personal data.
{
  const doc = new mupdf.PDFDocument();
  const helv = new mupdf.Font('Helvetica');
  const helvBold = new mupdf.Font('Helvetica-Bold');
  const F1 = doc.addSimpleFont(helv);
  const F2 = doc.addSimpleFont(helvBold);
  const width = (font, text, size) =>
    [...text].reduce((w, c) => w + font.advanceGlyph(font.encodeCharacter(c)) * size, 0);
  let content = '';
  const text = (font, name, size, x, y, s, align = 'left') => {
    const tx = align === 'right' ? x - width(font, s, size) : x;
    content += `BT /${name} ${size} Tf ${tx.toFixed(3)} ${y} Td (${escapePdfString(s)}) Tj ET\n`;
  };
  text(helvBold, 'F2', 22, 72, 720, 'INVOICE');
  text(helv, 'F1', 10, 72, 696, 'Example Studio LLC');
  text(helv, 'F1', 10, 72, 682, '100 Sample Street, Springfield');
  text(helv, 'F1', 10, 540, 720, 'Invoice #1042', 'right');
  text(helv, 'F1', 10, 540, 706, 'October 2026', 'right');
  text(helvBold, 'F2', 10, 72, 620, 'Description');
  text(helvBold, 'F2', 10, 400, 620, 'Qty', 'right');
  text(helvBold, 'F2', 10, 470, 620, 'Rate', 'right');
  text(helvBold, 'F2', 10, 540, 620, 'Amount', 'right');
  content += '0.6 G 0.5 w 72 612 m 540 612 l S\n';
  const rows = [
    ['Monthly hosting', '1', '$26', '$26'],
    ['Domain renewal', '1', '$14', '$14'],
    ['Support hours', '3', '$40', '$120'],
  ];
  rows.forEach(([d, q, r, a], i) => {
    const y = 596 - i * 18;
    text(helv, 'F1', 10, 72, y, d);
    text(helv, 'F1', 10, 400, y, q, 'right');
    text(helv, 'F1', 10, 470, y, r, 'right');
    text(helv, 'F1', 10, 540, y, a, 'right');
  });
  content += '0.6 G 0.5 w 72 530 m 540 530 l S\n';
  text(helvBold, 'F2', 10, 470, 514, 'Total', 'right');
  text(helvBold, 'F2', 10, 540, 514, '$160', 'right');
  const resources = doc.addObject({ Font: { F1, F2 } });
  doc.insertPage(-1, doc.addPage([0, 0, 612, 792], 0, resources, content));
  doc.setMetaData('info:Title', 'Invoice fixture');
  write('invoice.pdf', doc.saveToBuffer('garbage,compress').asUint8Array());
}

// Pages whose page space differs from PDF space: rotated, and a MediaBox not at the origin.
{
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica'));
  const resources = doc.addObject({ Font: { F1: font } });
  doc.insertPage(
    -1,
    doc.addPage([0, 0, 612, 792], 90, resources, 'BT /F1 12 Tf 72 720 Td (Rotated page) Tj ET'),
  );
  doc.insertPage(
    -1,
    doc.addPage([50, 50, 662, 842], 0, resources, 'BT /F1 12 Tf 122 770 Td (Offset page) Tj ET'),
  );
  write('rotated.pdf', doc.saveToBuffer('garbage,compress').asUint8Array());
}
