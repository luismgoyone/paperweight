import { describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { renderPageRGBA, searchDocument } from '../../src/engine/render';
import { fixture } from './helpers';

function open(name: string) {
  const s = new EngineSession();
  s.open(fixture(name));
  return s.doc;
}

describe('renderPageRGBA', () => {
  it('renders a page at the requested scale as RGBA', () => {
    const r = renderPageRGBA(open('simple.pdf'), 0, 0.5);
    expect(r.width).toBe(306);
    expect(r.height).toBe(396);
    expect(r.pixels.length).toBe(306 * 396 * 4);
    let dark = 0;
    for (let i = 0; i < r.pixels.length; i += 4) if (r.pixels[i]! < 128) dark++;
    expect(dark).toBeGreaterThan(0);
  });

  it('is opaque white where there is no content', () => {
    const r = renderPageRGBA(open('simple.pdf'), 0, 0.25);
    expect([...r.pixels.slice(0, 4)]).toEqual([255, 255, 255, 255]);
  });

  it('rejects out-of-range pages', () => {
    expect(() => renderPageRGBA(open('simple.pdf'), 3, 1)).toThrow();
  });
});

describe('searchDocument', () => {
  it('finds hits on the right pages with rects inside the page', () => {
    const hits = searchDocument(open('simple.pdf'), 'needle');
    expect(hits.map((h) => h.page)).toEqual([1, 2]);
    const r = hits[0]!.rects[0]!;
    expect(r.x).toBeGreaterThan(0);
    expect(r.y).toBeGreaterThan(0);
    expect(r.x + r.w).toBeLessThan(612);
    expect(r.y + r.h).toBeLessThan(792);
  });

  it('is case-insensitive', () => {
    expect(searchDocument(open('simple.pdf'), 'NEEDLE')).toHaveLength(2);
  });

  it('returns nothing for no match or a blank needle', () => {
    const doc = open('simple.pdf');
    expect(searchDocument(doc, 'zzz')).toEqual([]);
    expect(searchDocument(doc, '   ')).toEqual([]);
  });

  it('finds every hit across 100 pages', () => {
    const hits = searchDocument(open('100-pages.pdf'), 'invoice');
    expect(hits.map((h) => h.page)).toEqual([9, 19, 29, 39, 49, 59, 69, 79, 89, 99]);
  });

  it('stops at maxHits', () => {
    expect(searchDocument(open('100-pages.pdf'), 'Lorem', 5)).toHaveLength(5);
  });
});
