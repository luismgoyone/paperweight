import type * as mupdf from 'mupdf';

// Copying pages between documents (merge, extract, split).
//
// MuPDF's graftPage copies a page's content and resources but not its /Annots. Annotations
// must not be grafted wholesale: graftObject copies everything an object references, and an
// annotation's /P (or a link's destination, a widget's /Parent field) leads to its page, the
// page tree and therefore *every page of the source*. Extracting "just page 3" would then
// carry the rest of the document hidden inside the file (a privacy leak). So annotations are
// copied shallowly, without any key that points at pages, and links are kept only when their
// target page is copied too.

/** Keys never copied from an annotation: they point at pages, other annotations or fields. */
const PAGE_LINKED_KEYS = new Set(['P', 'Popup', 'Parent', 'IRT', 'Dest', 'A', 'AA', 'Kids']);

/** Field attributes a widget inherits from its parent fields. */
const INHERITED_FIELD_KEYS = ['FT', 'Ff', 'V', 'DV', 'DA', 'Q', 'Opt', 'MaxLen', 'TI'];

function nameOf(obj: mupdf.PDFObject): string | null {
  return obj.isName() ? obj.asName() : null;
}

/** The page a link goes to (source page object number), or null if it isn't an internal link. */
function linkTarget(annot: mupdf.PDFObject): { page: number; rest: mupdf.PDFObject[] } | null {
  let dest = annot.get('Dest');
  const action = annot.get('A');
  if (dest.isNull() && action.isDictionary() && nameOf(action.get('S')) === 'GoTo')
    dest = action.get('D');
  dest = dest.isNull() ? dest : dest.resolve();
  if (!dest.isArray() || dest.length === 0 || !dest.get(0).isIndirect()) return null;
  const rest: mupdf.PDFObject[] = [];
  for (let i = 1; i < dest.length; i++) rest.push(dest.get(i));
  return { page: dest.get(0).asIndirect(), rest };
}

function isUriLink(annot: mupdf.PDFObject): boolean {
  const action = annot.get('A');
  return action.isDictionary() && nameOf(action.get('S')) === 'URI';
}

/** Fully qualified field name and inherited attributes of a widget. */
function fieldInfo(widget: mupdf.PDFObject): {
  name: string;
  inherited: Map<string, mupdf.PDFObject>;
} {
  const parts: string[] = [];
  const inherited = new Map<string, mupdf.PDFObject>();
  let node = widget;
  for (let depth = 0; !node.isNull() && depth < 32; depth++) {
    const t = node.get('T');
    if (t.isString()) parts.unshift(t.asString());
    for (const key of INHERITED_FIELD_KEYS) {
      if (!inherited.has(key) && !node.get(key).isNull()) inherited.set(key, node.get(key));
    }
    node = node.get('Parent');
  }
  return { name: parts.join('.'), inherited };
}

function existingFieldNames(target: mupdf.PDFDocument): Set<string> {
  const names = new Set<string>();
  const fields = target.getTrailer().get('Root', 'AcroForm', 'Fields');
  const walk = (field: mupdf.PDFObject, prefix: string, depth: number) => {
    if (depth > 32) return;
    const t = field.get('T');
    const name = t.isString() ? (prefix ? `${prefix}.${t.asString()}` : t.asString()) : prefix;
    if (name) names.add(name);
    const kids = field.get('Kids');
    if (kids.isArray()) for (let i = 0; i < kids.length; i++) walk(kids.get(i), name, depth + 1);
  };
  if (fields.isArray()) for (let i = 0; i < fields.length; i++) walk(fields.get(i), '', 0);
  return names;
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} (${n})`)) return `${name} (${n})`;
}

/** The target's /AcroForm, created if needed; merges the source's default resources. */
function acroForm(
  target: mupdf.PDFDocument,
  map: mupdf.PDFGraftMap,
  src: mupdf.PDFDocument,
): mupdf.PDFObject {
  const root = target.getTrailer().get('Root');
  let form = root.get('AcroForm');
  if (form.isNull()) {
    form = target.addObject(target.newDictionary());
    root.put('AcroForm', form);
  }
  if (form.get('Fields').isNull()) form.put('Fields', target.newArray());
  const srcForm = src.getTrailer().get('Root', 'AcroForm');
  if (srcForm.isDictionary()) {
    if (form.get('DA').isNull() && !srcForm.get('DA').isNull())
      form.put('DA', map.graftObject(srcForm.get('DA')));
    const srcFonts = srcForm.get('DR', 'Font');
    if (srcFonts.isDictionary()) {
      if (form.get('DR').isNull()) form.put('DR', target.newDictionary());
      if (form.get('DR', 'Font').isNull()) form.get('DR').put('Font', target.newDictionary());
      const fonts = form.get('DR', 'Font');
      srcFonts.forEach((font, key) => {
        if (fonts.get(key).isNull()) fonts.put(key, map.graftObject(font));
      });
    }
  }
  return form;
}

/**
 * Copies `pages` of `src` into `target` before index `at`, with their annotations. One graft
 * map is used for the batch so shared fonts and images are copied once.
 */
export function graftPages(
  target: mupdf.PDFDocument,
  at: number,
  src: mupdf.PDFDocument,
  pages: number[],
): void {
  const map = target.newGraftMap();
  pages.forEach((p, i) => map.graftPage(at + i, src, p));

  // Source page object number -> target page reference, for links inside the batch.
  const copied = new Map<number, mupdf.PDFObject>();
  pages.forEach((p, i) => copied.set(src.findPage(p).asIndirect(), target.findPage(at + i)));

  const takenNames = existingFieldNames(target);
  let form: mupdf.PDFObject | null = null;

  pages.forEach((p, i) => {
    const ref = src.findPage(p).get('Annots');
    if (ref.isNull()) return;
    const annots = ref.resolve();
    if (!annots.isArray() || annots.length === 0) return;
    const page = target.findPage(at + i);
    const copies = target.newArray();

    for (let a = 0; a < annots.length; a++) {
      const annot = annots.get(a).resolve();
      if (!annot.isDictionary()) continue;
      const subtype = nameOf(annot.get('Subtype'));
      if (subtype === 'Popup') continue; // viewers recreate popups from the parent annotation

      const copy = target.newDictionary();
      annot.forEach((value, key) => {
        if (!PAGE_LINKED_KEYS.has(String(key))) copy.put(key, map.graftObject(value));
      });

      if (subtype === 'Link') {
        const internal = linkTarget(annot);
        if (internal) {
          const to = copied.get(internal.page);
          if (!to) continue; // its target page isn't part of this copy
          const dest = target.newArray();
          dest.push(to);
          for (const item of internal.rest) dest.push(map.graftObject(item));
          copy.put('Dest', dest);
        } else if (isUriLink(annot)) {
          copy.put('A', map.graftObject(annot.get('A')));
        } else {
          continue; // named destinations, launch/JavaScript actions: dropped
        }
      }

      if (subtype === 'Widget') {
        // A standalone field: fully qualified name plus inherited attributes.
        const { name, inherited } = fieldInfo(annot);
        if (!name) continue;
        for (const [key, value] of inherited)
          if (copy.get(key).isNull()) copy.put(key, map.graftObject(value));
        const unique = uniqueName(name, takenNames);
        takenNames.add(unique);
        copy.put('T', target.newString(unique));
      }

      copy.put('P', page);
      const obj = target.addObject(copy);
      copies.push(obj);
      if (subtype === 'Widget') {
        form ??= acroForm(target, map, src);
        form.get('Fields').push(obj);
      }
    }
    if (copies.length) page.put('Annots', copies);
  });
}
