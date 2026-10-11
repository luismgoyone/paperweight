import { describe, expect, it } from 'vitest';
import { createSerialQueue } from '../../src/editor/engine-client';

const delay = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

describe('createSerialQueue', () => {
  it('runs tasks one at a time in submission order', async () => {
    const enqueue = createSerialQueue();
    const log: string[] = [];
    const a = enqueue(async () => {
      log.push('a start');
      await delay(20, null);
      log.push('a end');
      return 'a';
    });
    const b = enqueue(async () => {
      log.push('b start');
      return 'b';
    });
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
    expect(log).toEqual(['a start', 'a end', 'b start']);
  });

  it('keeps going after a rejected task', async () => {
    const enqueue = createSerialQueue();
    const failed = enqueue(async () => {
      throw new Error('boom');
    });
    await expect(failed).rejects.toThrow('boom');
    expect(await enqueue(async () => 'ok')).toBe('ok');
  });
});
