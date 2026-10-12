import * as mupdf from 'mupdf';

// Objects added to the page content (text in Phase 2, images and signatures in Phase 3).
// Each object is its own content stream wrapped in a marked-content sequence carrying its id,
// so it can be found again for update and delete:  /PdfEditor <</Id (…)>> BDC … EMC
//
// The page's original content is wrapped in q … Q once, so whatever graphics state it leaves
// behind can't leak into ours.

const TAG = 'PdfEditor';
const WRAP_START = `% ${TAG}:wrap-start\nq\n`;
const WRAP_END = `% ${TAG}:wrap-end\nQ\n`;

export const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

export function marker(id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error('Invalid object id');
  return `/${TAG} <</Id (${id})>> BDC`;
}

/** `cm` operator that maps page space (as rendered, y down) back to PDF user space. */
export function pageSpaceCm(page: mupdf.PDFPage): string {
  return `${mupdf.Matrix.invert(page.getTransform()).map(fmt).join(' ')} cm`;
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

/**
 * Matches an object's opening marker however it was serialized: our own writer adds spaces,
 * MuPDF's content filter (used by redaction) removes them.
 */
function markerPattern(id: string): RegExp {
  marker(id); // validates the id
  return new RegExp(`/${TAG}\\s*<<\\s*/Id\\s*\\(${id}\\)\\s*>>\\s*BDC`);
}

type Section = { stream: number; text: string; start: number; end: number };

/**
 * Finds an object's marked-content section in any of the page's content streams: from its
 * marker to the matching EMC. Objects are addressed by section, not by stream, because
 * redaction merges all of a page's streams into one.
 */
function findSection(contents: mupdf.PDFObject, id: string): Section | null {
  const pattern = markerPattern(id);
  for (let i = 0; i < contents.length; i++) {
    const text = streamText(contents.get(i));
    const m = pattern.exec(text);
    if (!m) continue;
    // Our sections hold only our own operators (hex strings, names), so counting marked-content
    // operators is enough to find the matching EMC.
    const ops = /\b(BDC|BMC|EMC)\b/g;
    ops.lastIndex = m.index + m[0].length;
    let depth = 0;
    for (let op = ops.exec(text); op; op = ops.exec(text)) {
      if (op[1] !== 'EMC') depth++;
      else if (depth-- === 0) return { stream: i, text, start: m.index, end: op.index + 3 };
    }
    return null; // unbalanced: treat as missing rather than guess
  }
  return null;
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

/** Puts `create()` into the page's /Resources/<category> under `name` unless already there. */
export function ensureResource(
  doc: mupdf.PDFDocument,
  page: mupdf.PDFPage,
  category: 'Font' | 'XObject',
  name: string,
  create: () => mupdf.PDFObject,
): void {
  const resources = pageResources(doc, page.getObject());
  let dict = resources.get(category);
  if (dict.isNull()) {
    dict = doc.newDictionary();
    resources.put(category, dict);
  }
  if (dict.get(name).isNull()) dict.put(name, create());
}

export type ObjectAction =
  { kind: 'add' | 'update'; id: string; content: string } | { kind: 'delete'; id: string };

/** Adds, replaces or removes the content stream of one added object. */
export function writeObjectStream(
  doc: mupdf.PDFDocument,
  page: mupdf.PDFPage,
  action: ObjectAction,
): void {
  const contents = contentsArray(doc, page.getObject());
  const section = findSection(contents, action.id);
  if (action.kind === 'add' && section) {
    throw new Error(`An object with id ${action.id} already exists`);
  }
  if (action.kind !== 'add' && !section) throw new Error('That object no longer exists');
  const body = action.kind === 'delete' ? '' : `${marker(action.id)}\n${action.content}EMC\n`;
  if (section) {
    // Replace just this object's section; other objects may share the stream.
    const next = section.text.slice(0, section.start) + body + section.text.slice(section.end);
    contents.put(section.stream, doc.addStream(next, {}));
    return;
  }
  ensureWrapped(doc, contents);
  contents.push(doc.addStream(body, {}));
}
