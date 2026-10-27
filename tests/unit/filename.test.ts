import { describe, expect, it } from 'vitest';
import { downloadFileName, editedFileName, renamedFileName } from '../../src/shared/filename';

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

describe('renamedFileName', () => {
  it.each([
    ['contract', 'contract.pdf'],
    ['contract.pdf', 'contract.pdf'],
    ['Contract.PDF', 'Contract.pdf'],
    ['  signed copy  ', 'signed copy.pdf'],
    ['a/b\\c:d*e?f"g<h>i|j', 'a-b-c-d-e-f-g-h-i-j.pdf'],
    ['tab\there', 'tab-here.pdf'],
    ['my.report.v2', 'my.report.v2.pdf'],
  ])('%j -> %j', (input, expected) => {
    expect(renamedFileName(input)).toBe(expected);
  });

  it.each(['', '   ', '.pdf', ' .PDF '])('rejects %j', (input) => {
    expect(renamedFileName(input)).toBeNull();
  });
});

describe('downloadFileName', () => {
  it('adds -edited to the original name', () => {
    expect(downloadFileName('invoice.pdf', false)).toBe('invoice-edited.pdf');
  });

  it('keeps a name the user chose', () => {
    expect(downloadFileName('final.pdf', true)).toBe('final.pdf');
  });
});
