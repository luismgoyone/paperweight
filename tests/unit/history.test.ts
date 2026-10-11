import { describe, expect, it } from 'vitest';
import { History } from '../../src/editor/history';
import type { Op } from '../../src/shared/types';

const op = (title: string): Op => ({ kind: 'meta.setTitle', title });

describe('History', () => {
  it('starts empty and clean', () => {
    const h = new History();
    expect(h.active).toEqual([]);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.dirty).toBe(false);
  });

  it('push, undo, redo move the cursor', () => {
    const h = new History();
    h.push(op('a'));
    h.push(op('b'));
    h.push(op('c'));
    expect(h.cursor).toBe(3);
    h.undo();
    expect(h.active).toEqual([op('a'), op('b')]);
    expect(h.canRedo).toBe(true);
    h.redo();
    expect(h.active).toHaveLength(3);
    expect(h.canRedo).toBe(false);
  });

  it('pushing after undo drops the redo tail', () => {
    const h = new History();
    h.push(op('a'));
    h.push(op('b'));
    h.undo();
    h.push(op('c'));
    expect(h.active).toEqual([op('a'), op('c')]);
    h.redo();
    expect(h.active).toEqual([op('a'), op('c')]);
  });

  it('undo and redo are no-ops at the ends', () => {
    const h = new History();
    h.undo();
    h.redo();
    expect(h.cursor).toBe(0);
  });

  it('tracks dirtiness against the last saved point', () => {
    const h = new History();
    h.push(op('a'));
    expect(h.dirty).toBe(true);
    h.markSaved();
    expect(h.dirty).toBe(false);
    h.undo();
    expect(h.dirty).toBe(true);
    h.redo();
    expect(h.dirty).toBe(false);
  });

  it('is dirty when the saved point was branched away from', () => {
    const h = new History();
    h.push(op('a'));
    h.markSaved();
    h.undo();
    h.push(op('b'));
    expect(h.dirty).toBe(true);
  });

  it('reset clears everything', () => {
    const h = new History();
    h.push(op('a'));
    h.reset();
    expect(h.ops).toEqual([]);
    expect(h.dirty).toBe(false);
  });

  it('rejectLast removes a refused op without leaving it redoable', () => {
    const h = new History();
    h.push(op('a'));
    h.push(op('bad'));
    h.rejectLast();
    expect(h.active).toEqual([op('a')]);
    expect(h.canRedo).toBe(false);
  });
});
