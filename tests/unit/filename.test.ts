import { describe, expect, it } from 'vitest';
import { editedFileName } from '../../src/shared/filename';

describe('editedFileName', () => {
  it.each([
    ['invoice.pdf', 'invoice-edited.pdf'],
    ['A.PDF', 'A-edited.pdf'],
    ['scan', 'scan-edited.pdf'],
    ['my.report.v2.pdf', 'my.report.v2-edited.pdf'],
    ['.pdf', 'document-edited.pdf'],
    ['', 'document-edited.pdf'],
    ['  spaced name .pdf', 'spaced name-edited.pdf'],
  ])('%j -> %j', (input, expected) => {
    expect(editedFileName(input)).toBe(expected);
  });
});
