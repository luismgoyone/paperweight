import { describe, expect, it } from 'vitest';
import { ENGINE_BROKEN, isCrashError } from '../../src/engine/api';
import { OpError } from '../../src/engine/ops';

const named = (name: string, message = 'x') => Object.assign(new Error(message), { name });

describe('isCrashError', () => {
  it('treats WASM traps and a broken engine as crashes', () => {
    expect(isCrashError(named('RuntimeError', 'unreachable executed'))).toBe(true);
    expect(isCrashError(named(ENGINE_BROKEN))).toBe(true);
    expect(isCrashError(new Error('Aborted(OOM)'))).toBe(true);
    expect(isCrashError(new Error('memory access out of bounds'))).toBe(true);
    expect(isCrashError(new RangeError('Array buffer allocation failed'))).toBe(true);
  });

  it('does not treat ordinary failures as crashes', () => {
    expect(isCrashError(new OpError('bad op', { kind: 'meta.setTitle', title: '' }))).toBe(false);
    expect(isCrashError(named('OpError'))).toBe(false);
    expect(isCrashError(new RangeError('Page 4 does not exist'))).toBe(false);
    expect(isCrashError(new Error('No document is open'))).toBe(false);
    expect(isCrashError('nope')).toBe(false);
    expect(isCrashError(undefined)).toBe(false);
  });
});
