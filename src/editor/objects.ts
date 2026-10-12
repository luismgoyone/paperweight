import type { AnnotSpec, Op, Point, Rect, TextSpec } from '../shared/types';

// The objects the user has added, derived purely from the op log (spec §3.3).

export type EditorObject =
  | { id: string; page: number; kind: 'annot'; annot: AnnotSpec }
  | { id: string; page: number; kind: 'text'; spec: TextSpec }
  | { id: string; page: number; kind: 'image'; box: Rect; image: string };

export const NOTE_SIZE = 20;

type PageOp = Extract<Op, { kind: `page.${string}` }>;

/** Keeps objects on the right pages through page changes (spec §6 Phase 4). */
function remapPages(objects: Map<string, EditorObject>, op: PageOp): void {
  for (const [id, o] of objects) {
    let page: number | null = o.page;
    switch (op.kind) {
      case 'page.move':
        page = op.order.indexOf(o.page);
        break;
      case 'page.delete':
        page = op.pages.includes(o.page)
          ? null
          : o.page - op.pages.filter((p) => p < o.page).length;
        break;
      case 'page.insertBlank':
        if (o.page >= op.at) page = o.page + 1;
        break;
      case 'page.insertFrom':
        if (o.page >= op.at) page = o.page + op.pages.length;
        break;
      case 'page.rotate':
        // Objects rotate with their page in the PDF, but the model has no rotated text boxes;
        // they stay in the document and are no longer editable here.
        if (op.pages.includes(o.page)) page = null;
        break;
    }
    if (page === null || page < 0) objects.delete(id);
    else if (page !== o.page) objects.set(id, { ...o, page });
  }
}

export function foldObjects(ops: readonly Op[]): Map<string, EditorObject> {
  const objects = new Map<string, EditorObject>();
  for (const op of ops) {
    switch (op.kind) {
      case 'annot.add':
      case 'annot.update':
        objects.set(op.id, { id: op.id, page: op.page, kind: 'annot', annot: op.annot });
        break;
      case 'text.add':
      case 'text.update':
        objects.set(op.id, { id: op.id, page: op.page, kind: 'text', spec: op.spec });
        break;
      case 'image.add':
      case 'image.update':
        objects.set(op.id, {
          id: op.id,
          page: op.page,
          kind: 'image',
          box: op.box,
          image: op.image,
        });
        break;
      case 'annot.delete':
      case 'text.delete':
      case 'image.delete':
        objects.delete(op.id);
        break;
      case 'page.move':
      case 'page.delete':
      case 'page.insertBlank':
      case 'page.insertFrom':
      case 'page.rotate':
        remapPages(objects, op);
        break;
    }
  }
  return objects;
}

function boundsOf(points: Point[], pad = 0): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

export function objectBounds(o: EditorObject): Rect {
  if (o.kind === 'text') return o.spec.box;
  if (o.kind === 'image') return o.box;
  const a = o.annot;
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return boundsOf(a.quads.flat());
    case 'ink':
      return boundsOf(a.paths.flat(), a.width / 2);
    case 'rect':
    case 'ellipse':
      return {
        x: a.rect.x - a.width / 2,
        y: a.rect.y - a.width / 2,
        w: a.rect.w + a.width,
        h: a.rect.h + a.width,
      };
    case 'line':
    case 'arrow':
      return boundsOf([a.a, a.b], a.width / 2);
    case 'note':
      return { x: a.at.x, y: a.at.y, w: NOTE_SIZE, h: NOTE_SIZE };
  }
}

const contains = (r: Rect, p: Point, tolerance: number) =>
  p.x >= r.x - tolerance &&
  p.x <= r.x + r.w + tolerance &&
  p.y >= r.y - tolerance &&
  p.y <= r.y + r.h + tolerance;

/** The topmost object on `page` under `p` (later objects are drawn on top). */
export function hitTest(
  objects: readonly EditorObject[],
  page: number,
  p: Point,
  tolerance: number,
): EditorObject | undefined {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]!;
    if (o.page === page && contains(objectBounds(o), p, tolerance)) return o;
  }
  return undefined;
}

const move = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });

export function translate(o: EditorObject, dx: number, dy: number): EditorObject {
  if (o.kind === 'image') return { ...o, box: { ...o.box, x: o.box.x + dx, y: o.box.y + dy } };
  if (o.kind === 'text') {
    return {
      ...o,
      spec: { ...o.spec, box: { ...o.spec.box, x: o.spec.box.x + dx, y: o.spec.box.y + dy } },
    };
  }
  const a = o.annot;
  let annot: AnnotSpec;
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      annot = { ...a, quads: a.quads.map((q) => q.map((p) => move(p, dx, dy)) as typeof q) };
      break;
    case 'ink':
      annot = { ...a, paths: a.paths.map((path) => path.map((p) => move(p, dx, dy))) };
      break;
    case 'rect':
    case 'ellipse':
      annot = { ...a, rect: { ...a.rect, x: a.rect.x + dx, y: a.rect.y + dy } };
      break;
    case 'line':
    case 'arrow':
      annot = { ...a, a: move(a.a, dx, dy), b: move(a.b, dx, dy) };
      break;
    case 'note':
      annot = { ...a, at: move(a.at, dx, dy) };
      break;
  }
  return { ...o, annot };
}
