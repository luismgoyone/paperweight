import type { Op } from '../shared/types';
import type { EditorObject } from './objects';

/** The op that writes `object` back (update) or removes it (delete). */
export function objectOp(object: EditorObject, kind: 'update' | 'delete'): Op {
  const base = { id: object.id, page: object.page };
  switch (object.kind) {
    case 'annot':
      return kind === 'delete'
        ? { kind: 'annot.delete', ...base }
        : { kind: 'annot.update', ...base, annot: object.annot };
    case 'text':
      return kind === 'delete'
        ? { kind: 'text.delete', ...base }
        : { kind: 'text.update', ...base, spec: object.spec };
    case 'image':
      return kind === 'delete'
        ? { kind: 'image.delete', ...base }
        : { kind: 'image.update', ...base, box: object.box, image: object.image };
  }
}
