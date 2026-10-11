import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { OpError } from '../../src/engine/ops';
import type { Op } from '../../src/shared/types';
import { fixture } from './helpers';

const op = (title: string): Op => ({ kind: 'meta.setTitle', title });
const ops = (n: number) => Array.from({ length: n }, (_, i) => op(`t${i + 1}`));

function session() {
  const s = new EngineSession();
  s.open(fixture('simple.pdf'));
  return s;
}
const title = (s: EngineSession) => s.doc.getMetaData('info:Title');

describe('EngineSession.setOps', () => {
  it('applies meta.setTitle', () => {
    const s = session();
    s.setOps([op('Hello')]);
    expect(title(s)).toBe('Hello');
  });

  it('checkpoints every 20 ops', () => {
    const s = session();
    s.setOps(ops(45));
    expect(title(s)).toBe('t45');
    expect(s.checkpointIndices).toEqual([20, 40]);
  });

  it('applies incrementally when ops are appended', () => {
    const s = session();
    const all = ops(5);
    s.setOps(all.slice(0, 3));
    s.setOps(all);
    expect(title(s)).toBe('t5');
  });

  it('undoes by replaying from the nearest checkpoint', () => {
    const s = session();
    const all = ops(45);
    s.setOps(all);
    s.setOps(all.slice(0, 25));
    expect(title(s)).toBe('t25');
    expect(s.checkpointIndices).toEqual([20]);
  });

  it('branches after undo and drops stale checkpoints', () => {
    const s = session();
    const all = ops(45);
    s.setOps(all);
    s.setOps([...all.slice(0, 25), op('branch')]);
    expect(title(s)).toBe('branch');
    expect(s.checkpointIndices).toEqual([20]);
    s.setOps(all.slice(0, 10));
    expect(title(s)).toBe('t10');
    expect(s.checkpointIndices).toEqual([]);
  });

  it('undoing everything restores the original', () => {
    const s = session();
    s.setOps(ops(3));
    s.setOps([]);
    expect(title(s)).toBe('Fixture');
  });

  it('saves the edited document', () => {
    const s = session();
    s.setOps([op('Saved title')]);
    const doc = mupdf.Document.openDocument(s.save(), 'application/pdf');
    expect(doc.getMetaData('info:Title')).toBe('Saved title');
  });

  it('rejects an op that fails and keeps the prior state', () => {
    const s = session();
    s.setOps([op('Good')]);
    const bad = { kind: 'nope' } as unknown as Op;
    expect(() => s.setOps([op('Good'), op('Also good'), bad])).toThrow(OpError);
    expect(title(s)).toBe('Good');
    s.setOps([op('Good'), op('Next')]);
    expect(title(s)).toBe('Next');
  });

  it('replays from checkpoints of a password-protected file', () => {
    const s = new EngineSession();
    s.open(fixture('encrypted.pdf'), 'secret');
    const all = ops(25);
    s.setOps(all);
    s.setOps(all.slice(0, 22));
    expect(title(s)).toBe('t22');
    s.setOps(all.slice(0, 2));
    expect(title(s)).toBe('t2');
  });
});
