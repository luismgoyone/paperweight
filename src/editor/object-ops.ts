import type { Op } from '../shared/types';
import type { EditorObject } from './objects';

/** The op that writes `object` back (update) or removes it (delete). */
export function objectOp(object: EditorObject, kind: 'update' | 'delete'): Op {
  const base = { id: object.id, page: object.page };
  if (kind === 'delete') {
    return object.kind === 'annot'
      ? { kind: 'annot.delete', ...base }
      : { kind: 'text.delete', ...base };
  }
  return object.kind === 'annot'
    ? { kind: 'annot.update', ...base, annot: object.annot }
    : { kind: 'text.update', ...base, spec: object.spec };
}
