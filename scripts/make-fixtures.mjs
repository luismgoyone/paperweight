// Generates the synthetic PDF fixtures in tests/fixtures/ (no real personal data).
// Run with: npm run fixtures
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
// `invoice-31.pdf` is the same invoice with the first amount reading "$31": the reference for
// the success-criterion-1 golden test (editing "$26" -> "$31" must look like this).
function makeInvoice(firstAmount) {
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
    ['Monthly hosting', '1', '$26', firstAmount],
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
  return doc.saveToBuffer('garbage,compress').asUint8Array();
}
write('invoice.pdf', makeInvoice('$26'));
write('invoice-31.pdf', makeInvoice('$31'));

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

// An AcroForm (spec §9): text, multiline, read-only, checkbox, radio group, dropdown.
{
  const doc = new mupdf.PDFDocument();
  const helv = doc.addSimpleFont(new mupdf.Font('Helvetica'));
  const dr = doc.addObject({ Font: { Helv: helv } });
  const resources = doc.addObject({ Font: { F1: helv } });
  let content = '';
  const label = (x, y, s) =>
    (content += `BT /F1 10 Tf ${x} ${y} Td (${escapePdfString(s)}) Tj ET\n`);
  label(72, 720, 'Name');
  label(72, 680, 'Notes');
  label(72, 600, 'Account (read-only)');
  label(72, 560, 'Subscribe');
  label(72, 520, 'Plan');
  label(72, 480, 'Country');
  label(72, 440, 'Signature date');
  label(72, 400, 'Size');
  const pageObj = doc.addPage([0, 0, 612, 792], 0, resources, content);
  doc.insertPage(-1, pageObj);
  const page = doc.findPage(0);

  const fields = doc.newArray();
  const annots = doc.newArray();
  const box = (x0, y0, x1, y1) => [x0, y0, x1, y1];
  const onOff = (on) => {
    const off = doc.addStream('', { BBox: [0, 0, 12, 12], Resources: {} });
    const yes = doc.addStream('0 g 2 2 8 8 re f', { BBox: [0, 0, 12, 12], Resources: {} });
    const n = doc.newDictionary();
    n.put(on, yes);
    n.put('Off', off);
    return n;
  };
  const widget = (dict) => {
    const obj = doc.addObject({
      Type: doc.newName('Annot'),
      Subtype: doc.newName('Widget'),
      F: 4,
      P: page,
      ...dict,
    });
    annots.push(obj);
    return obj;
  };
  const text = (name, rect, extra = {}) =>
    fields.push(
      widget({
        FT: doc.newName('Tx'),
        T: doc.newString(name),
        Rect: rect,
        DA: doc.newString('/Helv 10 Tf 0 g'),
        ...extra,
      }),
    );

  text('name', box(180, 712, 400, 728), { V: doc.newString('') });
  text('notes', box(180, 640, 400, 692), { Ff: 4096, V: doc.newString('') }); // multiline
  text('account', box(180, 592, 400, 608), { Ff: 1, V: doc.newString('ACCT-001') }); // read-only
  text('dates.signed', box(180, 432, 300, 448), { V: doc.newString('') });

  const check = widget({
    FT: doc.newName('Btn'),
    T: doc.newString('subscribe'),
    Rect: box(180, 556, 192, 568),
    V: doc.newName('Off'),
    AS: doc.newName('Off'),
  });
  const checkAp = doc.newDictionary();
  checkAp.put('N', onOff('Yes'));
  check.put('AP', checkAp);
  fields.push(check);

  const radio = doc.addObject({
    FT: doc.newName('Btn'),
    T: doc.newString('plan'),
    Ff: 32768 | 16384,
    V: doc.newName('Off'),
  });
  const kids = doc.newArray();
  ['basic', 'pro', 'team'].forEach((state, i) => {
    const kid = widget({
      Parent: radio,
      Rect: box(180 + i * 60, 516, 192 + i * 60, 528),
      AS: doc.newName('Off'),
    });
    const ap = doc.newDictionary();
    ap.put('N', onOff(state));
    kid.put('AP', ap);
    kids.push(kid);
  });
  radio.put('Kids', kids);
  fields.push(radio);

  const opts = doc.newArray();
  ['Canada', 'Mexico', 'United States'].forEach((o) => opts.push(doc.newString(o)));
  fields.push(
    widget({
      FT: doc.newName('Ch'),
      T: doc.newString('country'),
      Ff: 131072,
      Opt: opts,
      Rect: box(180, 472, 330, 488),
      DA: doc.newString('/Helv 10 Tf 0 g'),
      V: doc.newString(''),
    }),
  );

  // A dropdown whose options have export values different from their labels.
  const sizes = doc.newArray();
  [
    ['S', 'Small'],
    ['M', 'Medium'],
    ['L', 'Large'],
  ].forEach(([value, text]) => {
    const pair = doc.newArray();
    pair.push(doc.newString(value));
    pair.push(doc.newString(text));
    sizes.push(pair);
  });
  fields.push(
    widget({
      FT: doc.newName('Ch'),
      T: doc.newString('size'),
      Ff: 131072,
      Opt: sizes,
      Rect: box(180, 392, 300, 408),
      DA: doc.newString('/Helv 10 Tf 0 g'),
      V: doc.newString('S'),
    }),
  );
  // A widget without a name: not fillable, must be ignored.
  annots.push(
    doc.addObject({
      Type: doc.newName('Annot'),
      Subtype: doc.newName('Widget'),
      FT: doc.newName('Tx'),
      F: 4,
      P: page,
      Rect: box(400, 392, 500, 408),
    }),
  );

  page.put('Annots', annots);
  doc
    .getTrailer()
    .get('Root')
    .put(
      'AcroForm',
      doc.addObject({
        Fields: fields,
        DR: dr,
        DA: doc.newString('/Helv 10 Tf 0 g'),
        NeedAppearances: true,
      }),
    );
  write('form.pdf', doc.saveToBuffer('garbage,compress').asUint8Array());
}

// An embedded TrueType font subset to the glyphs it uses (spec §9 "subset-font PDF"): editing
// in a character the subset lacks must fall back to a bundled font and say so.
{
  const doc = new mupdf.PDFDocument();
  const bytes = readFileSync(
    new URL('../public/fonts/LiberationSans-Regular.ttf', import.meta.url),
  );
  const font = new mupdf.Font('LiberationSans', bytes);
  const F1 = doc.addFont(font);
  const hex = (s) =>
    [...s]
      .map((c) => font.encodeCharacter(c.codePointAt(0)).toString(16).padStart(4, '0'))
      .join('');
  const content = `BT /F1 12 Tf 72 700 Td <${hex('Total $26')}> Tj ET\n`;
  const resources = doc.addObject({ Font: { F1 } });
  doc.insertPage(-1, doc.addPage([0, 0, 612, 792], 0, resources, content));
  doc.subsetFonts();
  write('subset-font.pdf', doc.saveToBuffer('garbage,compress').asUint8Array());
}
