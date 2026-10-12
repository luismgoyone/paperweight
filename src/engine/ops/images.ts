import * as mupdf from 'mupdf';
import type { Op, Rect } from '../../shared/types';
import { getImageBytes } from '../images';
import { ensureResource, fmt, pageSpaceCm, writeObjectStream } from './content';

// Images and signatures are drawn into the page content like added text (see content.ts):
// one tagged stream per placed image that paints a shared image XObject.

const resourceName = (key: string) => `PEImg-${key}`;

// One embedded XObject per image per document, however many times it's placed.
const embedded = new WeakMap<mupdf.PDFDocument, Map<string, mupdf.PDFObject>>();

function imageObject(doc: mupdf.PDFDocument, key: string): mupdf.PDFObject {
  let byKey = embedded.get(doc);
  if (!byKey) embedded.set(doc, (byKey = new Map()));
  let obj = byKey.get(key);
  if (!obj) {
    // A document rebuilt from a checkpoint may already contain it on some page.
    const name = resourceName(key);
    for (let i = 0; i < doc.countPages() && !obj; i++) {
      const found = doc.findPage(i).get('Resources', 'XObject', name);
      if (!found.isNull()) obj = found;
    }
    obj ??= doc.addImage(new mupdf.Image(getImageBytes(key)));
    byKey.set(key, obj);
  }
  return obj;
}

function content(page: mupdf.PDFPage, key: string, box: Rect): string {
  // The unit square maps to the box with the image's top edge at box.y (page space, y down).
  return `q\n${pageSpaceCm(page)}\n${fmt(box.w)} 0 0 ${fmt(-box.h)} ${fmt(box.x)} ${fmt(box.y + box.h)} cm\n/${resourceName(key)} Do\nQ\n`;
}

type ImageOp = Extract<Op, { kind: 'image.add' | 'image.update' | 'image.delete' }>;

export function applyImageOp(doc: mupdf.PDFDocument, op: ImageOp): void {
  const page = doc.loadPage(op.page);
  try {
    if (op.kind === 'image.delete') {
      writeObjectStream(doc, page, { kind: 'delete', id: op.id });
      return;
    }
    if (op.box.w <= 0 || op.box.h <= 0) throw new Error('The image has no size');
    ensureResource(doc, page, 'XObject', resourceName(op.image), () => imageObject(doc, op.image));
    writeObjectStream(doc, page, {
      kind: op.kind === 'image.add' ? 'add' : 'update',
      id: op.id,
      content: content(page, op.image, op.box),
    });
  } finally {
    page.destroy();
  }
}
