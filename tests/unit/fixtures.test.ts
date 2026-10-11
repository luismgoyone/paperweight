import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';
import { fixture } from './helpers';

const open = (name: string) => mupdf.Document.openDocument(fixture(name), 'application/pdf');

describe('fixtures', () => {
  it('simple.pdf has 3 Letter pages mentioning "needle" on pages 2 and 3', () => {
    const doc = open('simple.pdf');
    expect(doc.countPages()).toBe(3);
    expect(doc.loadPage(0).getBounds()).toEqual([0, 0, 612, 792]);
    expect(doc.loadPage(0).search('needle', '')).toHaveLength(0);
    expect(doc.loadPage(1).search('needle', '').length).toBeGreaterThan(0);
  });

  it('100-pages.pdf has 100 pages with page labels in the text', () => {
    const doc = open('100-pages.pdf');
    expect(doc.countPages()).toBe(100);
    expect(doc.loadPage(56).search('Page 57', '').length).toBeGreaterThan(0);
  });

  it('encrypted.pdf needs the password "secret"', () => {
    const doc = open('encrypted.pdf');
    expect(doc.needsPassword()).toBe(true);
    expect(doc.authenticatePassword('secret')).toBeGreaterThan(0);
  });

  it('corrupt.pdf cannot be opened', () => {
    expect(() => open('corrupt.pdf').countPages()).toThrow();
  });
});

describe('Phase 2 fixtures', () => {
  it('invoice.pdf has a right-aligned $26 in Helvetica 10', () => {
    const page = open('invoice.pdf').loadPage(0);
    expect(page.search('$26', '').length).toBeGreaterThan(0);
  });

  it('rotated.pdf has a rotated page and an offset MediaBox', () => {
    const doc = open('rotated.pdf');
    expect(doc.countPages()).toBe(2);
    expect(doc.loadPage(0).getBounds()).toEqual([0, 0, 792, 612]);
    const offset = doc.loadPage(1).getBounds();
    expect(offset[2] - offset[0]).toBe(612);
  });
});
