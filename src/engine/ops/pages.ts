import type * as mupdf from 'mupdf';
import type { Op } from '../../shared/types';
import { getDocument } from '../documents';
import { graftPages } from '../graft';

type PageOp = Extract<Op, { kind: `page.${string}` }>;

function checkIndices(pages: number[], count: number): void {
  if (!pages.length) throw new Error('No pages selected');
  for (const p of pages) {
    if (!Number.isInteger(p) || p < 0 || p >= count)
      throw new Error(`Page ${p + 1} does not exist`);
  }
}

/** /Rotate of a page, following inheritance from the page tree. */
function currentRotation(pageObj: mupdf.PDFObject): number {
  let node: mupdf.PDFObject = pageObj;
  while (!node.isNull()) {
    const r = node.get('Rotate');
    if (!r.isNull()) return r.asNumber();
    node = node.get('Parent');
  }
  return 0;
}

export function applyPageOp(doc: mupdf.PDFDocument, op: PageOp): void {
  const count = doc.countPages();
  switch (op.kind) {
    case 'page.move': {
      const sorted = [...op.order].sort((a, b) => a - b);
      if (sorted.length !== count || sorted.some((p, i) => p !== i)) {
        throw new Error('The new page order is not valid');
      }
      doc.rearrangePages(op.order);
      return;
    }
    case 'page.rotate':
      checkIndices(op.pages, count);
      for (const p of new Set(op.pages)) {
        const obj = doc.findPage(p);
        obj.put('Rotate', (((currentRotation(obj) + op.by) % 360) + 360) % 360);
      }
      return;
    case 'page.delete': {
      checkIndices(op.pages, count);
      const unique = [...new Set(op.pages)].sort((a, b) => b - a);
      if (unique.length >= count)
        throw new Error("A PDF needs at least one page; you can't delete them all");
      for (const p of unique) doc.deletePage(p);
      return;
    }
    case 'page.insertBlank': {
      if (op.at < 0 || op.at > count) throw new Error('Invalid position');
      if (!(op.width > 0 && op.height > 0)) throw new Error('Invalid page size');
      doc.insertPage(op.at, doc.addPage([0, 0, op.width, op.height], 0, {}, ''));
      return;
    }
    case 'page.insertFrom': {
      if (op.at < 0 || op.at > count) throw new Error('Invalid position');
      const source = getDocument(op.source);
      checkIndices(op.pages, source.countPages());
      graftPages(doc, op.at, source, op.pages);
      return;
    }
  }
}
