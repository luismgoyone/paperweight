import type * as mupdf from 'mupdf';
import type { AnnotSpec, Op, Point, Quad } from '../../shared/types';

// Coordinates are page space (as rendered); MuPDF's annotation API takes the same space and
// handles /Rotate and MediaBox offsets itself.

const PDF_TYPE: Record<AnnotSpec['type'], mupdf.PDFAnnotationType> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
  ink: 'Ink',
  rect: 'Square',
  ellipse: 'Circle',
  line: 'Line',
  arrow: 'Line',
  note: 'Text',
};

const NOTE_SIZE = 20;

const pt = (p: Point): mupdf.Point => [p.x, p.y];
const quad = ([a, b, c, d]: Quad): mupdf.Quad => [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y];

function findAnnot(page: mupdf.PDFPage, id: string): mupdf.PDFAnnotation | undefined {
  return page.getAnnotations().find((a) => a.getName() === id);
}

function create(page: mupdf.PDFPage, id: string, spec: AnnotSpec): void {
  if (findAnnot(page, id)) throw new Error(`An object with id ${id} already exists`);
  const annot = page.createAnnotation(PDF_TYPE[spec.type]);
  annot.setName(id);
  annot.setColor(spec.color);
  switch (spec.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      if (!spec.quads.length) throw new Error('Nothing is selected');
      annot.setQuadPoints(spec.quads.map(quad));
      annot.setOpacity(spec.opacity);
      break;
    case 'ink':
      if (!spec.paths.some((p) => p.length > 0)) throw new Error('The drawing is empty');
      annot.setInkList(spec.paths.map((path) => path.map(pt)));
      annot.setBorderWidth(spec.width);
      annot.setOpacity(spec.opacity);
      break;
    case 'rect':
    case 'ellipse': {
      const { x, y, w, h } = spec.rect;
      annot.setRect([x, y, x + w, y + h]);
      annot.setInteriorColor(spec.fill ?? []);
      annot.setBorderWidth(spec.width);
      annot.setOpacity(spec.opacity);
      break;
    }
    case 'line':
    case 'arrow':
      annot.setLine(pt(spec.a), pt(spec.b));
      annot.setLineEndingStyles('None', spec.type === 'arrow' ? 'OpenArrow' : 'None');
      annot.setBorderWidth(spec.width);
      annot.setOpacity(spec.opacity);
      break;
    case 'note':
      annot.setRect([spec.at.x, spec.at.y, spec.at.x + NOTE_SIZE, spec.at.y + NOTE_SIZE]);
      annot.setContents(spec.text);
      annot.setIcon('Comment');
      break;
  }
  annot.update();
}

function remove(page: mupdf.PDFPage, id: string): void {
  const annot = findAnnot(page, id);
  if (!annot) throw new Error('That object no longer exists');
  page.deleteAnnotation(annot);
}

type AnnotOp = Extract<Op, { kind: 'annot.add' | 'annot.update' | 'annot.delete' }>;

export function applyAnnotOp(doc: mupdf.PDFDocument, op: AnnotOp): void {
  const page = doc.loadPage(op.page);
  try {
    switch (op.kind) {
      case 'annot.add':
        return create(page, op.id, op.annot);
      case 'annot.update':
        // Replacing keeps every property exact and the op log simple.
        remove(page, op.id);
        return create(page, op.id, op.annot);
      case 'annot.delete':
        return remove(page, op.id);
    }
  } finally {
    page.destroy();
  }
}
