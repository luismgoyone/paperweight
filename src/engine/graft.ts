import type * as mupdf from 'mupdf';

/**
 * Copies page `srcPage` of `src` into `target` before index `to`, including its annotations
 * (MuPDF's graftPage copies content and resources but not /Annots). Use one graft map for a
 * batch of pages so shared fonts and images are copied once.
 */
export function graftPageWithAnnots(
  target: mupdf.PDFDocument,
  map: mupdf.PDFGraftMap,
  to: number,
  src: mupdf.PDFDocument,
  srcPage: number,
): void {
  map.graftPage(to, src, srcPage);
  const ref = src.findPage(srcPage).get('Annots');
  if (ref.isNull()) return;
  const annots = ref.resolve();
  if (!annots.isArray() || annots.length === 0) return;
  const page = target.findPage(to);
  const copies = target.newArray();
  for (let i = 0; i < annots.length; i++) {
    const copy = map.graftObject(annots.get(i));
    // /P pointed at the source page; point it at the new one (the stray copy is garbage).
    copy.resolve().put('P', page);
    copies.push(copy);
  }
  page.put('Annots', copies);
}
