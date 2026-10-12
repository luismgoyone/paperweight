import * as mupdf from 'mupdf';
import { LINE_HEIGHT, firstBaselineOffset, fontId } from '../../shared/fonts';
import type { Op, TextSpec } from '../../shared/types';
import { getFont } from '../fonts';

// Added text is rendered into the page content (spec §6 Phase 2). Each text object is its own
// content stream, wrapped in a marked-content sequence carrying its id, so it can be found
// again for update and delete:  /PdfEditor <</Id (…)>> BDC … EMC
//
// The page's original content is wrapped in q … Q once, so whatever graphics state it leaves
// behind can't leak into ours.

const TAG = 'PdfEditor';
const WRAP_START = `% ${TAG}:wrap-start\nq\n`;
const WRAP_END = `% ${TAG}:wrap-end\nQ\n`;

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

function marker(id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error('Invalid object id');
  return `/${TAG} <</Id (${id})>> BDC`;
}

function streamText(obj: mupdf.PDFObject): string {
  const buffer = obj.readStream();
  try {
    return buffer.asString();
  } finally {
    buffer.destroy();
  }
}

/**
 * The page's /Contents as an array that belongs to this page alone. Pages may share one
 * indirect Contents array (or stream), so we always give the page its own direct array holding
 * the same stream references before changing anything.
 */
function contentsArray(doc: mupdf.PDFDocument, pageObj: mupdf.PDFObject): mupdf.PDFObject {
  const current = pageObj.get('Contents');
  if (current.isArray() && !current.isIndirect()) return current;
  const own = doc.newArray();
  const resolved = current.resolve();
  if (resolved.isArray()) {
    for (let i = 0; i < resolved.length; i++) own.push(resolved.get(i));
  } else if (!current.isNull()) {
    own.push(current);
  }
  pageObj.put('Contents', own);
  return own;
}

function ensureWrapped(doc: mupdf.PDFDocument, contents: mupdf.PDFObject): void {
  const first = contents.length > 0 ? contents.get(0) : null;
  if (first && streamText(first).startsWith(WRAP_START)) return;
  const original: mupdf.PDFObject[] = [];
  for (let i = 0; i < contents.length; i++) original.push(contents.get(i));
  while (contents.length) contents.delete(0);
  contents.push(doc.addStream(WRAP_START, {}));
  for (const o of original) contents.push(o);
  contents.push(doc.addStream(WRAP_END, {}));
}

function findStream(contents: mupdf.PDFObject, id: string): number {
  const needle = marker(id);
  for (let i = 0; i < contents.length; i++) {
    if (streamText(contents.get(i)).includes(needle)) return i;
  }
  return -1;
}

/** Resolves the page /Resources dictionary, creating or copying an inherited one if needed. */
function pageResources(doc: mupdf.PDFDocument, pageObj: mupdf.PDFObject): mupdf.PDFObject {
  let res = pageObj.get('Resources');
  if (res.isNull()) {
    let parent = pageObj.get('Parent');
    while (!parent.isNull() && res.isNull()) {
      res = parent.get('Resources');
      parent = parent.get('Parent');
    }
    const copy = doc.newDictionary();
    if (!res.isNull()) res.forEach((value, key) => copy.put(key, value));
    pageObj.put('Resources', copy);
    res = copy;
  }
  return res.resolve();
}

const resourceName = (id: string) => `PE-${id}`;

function ensureFontResource(doc: mupdf.PDFDocument, pageObj: mupdf.PDFObject, id: string): void {
  const resources = pageResources(doc, pageObj);
  let fonts = resources.get('Font');
  if (fonts.isNull()) {
    fonts = doc.newDictionary();
    resources.put('Font', fonts);
  }
  if (fonts.get(resourceName(id)).isNull()) fonts.put(resourceName(id), doc.addFont(getFont(id)));
}

/** Glyph ids for a line, or throws if the font lacks a character. */
function encode(font: mupdf.Font, family: string, line: string): number[] {
  return [...line].map((ch) => {
    const gid = font.encodeCharacter(ch.codePointAt(0)!);
    if (gid <= 0)
      throw new Error(`${family} can't display "${ch}". Remove it or pick another font.`);
    return gid;
  });
}

function buildContent(
  page: mupdf.PDFPage,
  resourceName: string,
  id: string,
  spec: TextSpec,
): string {
  const { box, text, style } = spec;
  const font = getFont(fontId(style.family, style));
  // Content is drawn in page space: undo the page transform, then flip y back for glyphs.
  const [a, b, c, d, e, f] = mupdf.Matrix.invert(page.getTransform());
  const [r, g, bl] = style.color;
  let out = `${marker(id)}\nq\n${[a, b, c, d, e, f].map(fmt).join(' ')} cm\n${fmt(r)} ${fmt(g)} ${fmt(bl)} rg\nBT\n/${resourceName} ${fmt(style.size)} Tf\n`;
  const baseline0 = box.y + firstBaselineOffset(style.family, style.size);
  text.split('\n').forEach((line, i) => {
    const gids = encode(font, style.family, line);
    const width = gids.reduce((w, gid) => w + font.advanceGlyph(gid) * style.size, 0);
    const x =
      style.align === 'right'
        ? box.x + box.w - width
        : style.align === 'center'
          ? box.x + (box.w - width) / 2
          : box.x;
    const y = baseline0 + i * LINE_HEIGHT * style.size;
    const hex = gids.map((gid) => gid.toString(16).padStart(4, '0')).join('');
    out += `1 0 0 -1 ${fmt(x)} ${fmt(y)} Tm <${hex}> Tj\n`;
  });
  return `${out}ET\nQ\nEMC\n`;
}

type TextOp = Extract<Op, { kind: 'text.add' | 'text.update' | 'text.delete' }>;

export function applyTextOp(doc: mupdf.PDFDocument, op: TextOp): void {
  const page = doc.loadPage(op.page);
  try {
    const pageObj = page.getObject();
    const contents = contentsArray(doc, pageObj);
    const existing = findStream(contents, op.id);
    if (op.kind === 'text.add' && existing >= 0)
      throw new Error(`An object with id ${op.id} already exists`);
    if (op.kind !== 'text.add' && existing < 0) throw new Error('That text no longer exists');

    if (op.kind === 'text.delete') {
      contents.delete(existing);
      return;
    }
    const spec = op.spec;
    const id = fontId(spec.style.family, spec.style);
    // Build (and encode) first so an unsupported character rejects the op before any change.
    const content = buildContent(page, resourceName(id), op.id, spec);
    ensureFontResource(doc, pageObj, id);
    ensureWrapped(doc, contents);
    const stream = doc.addStream(content, {});
    if (op.kind === 'text.update') contents.put(findStream(contents, op.id), stream);
    else contents.push(stream);
  } finally {
    page.destroy();
  }
}
