import { readFileSync } from 'node:fs';
import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';
import { ALL_FONTS, familyForPdfFont, fontFile, fontId } from '../../src/shared/fonts';

describe('bundled fonts', () => {
  it('has 6 families × 4 styles', () => {
    expect(ALL_FONTS).toHaveLength(24);
  });

  it.each(ALL_FONTS.map((f) => [fontId(f.family, f), f] as const))('%s loads in MuPDF', (id, f) => {
    const bytes = readFileSync(new URL(`../../public/${fontFile(f.family, f)}`, import.meta.url));
    const font = new mupdf.Font(id, bytes);
    expect(font.encodeCharacter('A')).toBeGreaterThan(0);
    expect(font.encodeCharacter('$')).toBeGreaterThan(0);
    expect(font.isBold()).toBe(f.bold);
  });

  it('names files and ids predictably', () => {
    expect(fontFile('Liberation Sans', { bold: true, italic: false })).toBe(
      'fonts/LiberationSans-Bold.ttf',
    );
    expect(fontFile('Noto Serif', { bold: false, italic: false })).toBe(
      'fonts/NotoSerif-Regular.ttf',
    );
    expect(fontId('Inter', { bold: true, italic: true })).toBe('Inter-BoldItalic');
  });
});

describe('familyForPdfFont (spec §4)', () => {
  it.each([
    ['Helvetica', 'Liberation Sans'],
    ['ABCDEF+Arial-BoldMT', 'Liberation Sans'],
    ['ArialMT', 'Liberation Sans'],
    ['Times-Roman', 'Liberation Serif'],
    ['TimesNewRomanPSMT', 'Liberation Serif'],
    ['Courier', 'Liberation Mono'],
    ['XYZABC+CourierNewPSMT', 'Liberation Mono'],
    ['Inter-Regular', 'Inter'],
    ['NotoSerif-Bold', 'Noto Serif'],
    ['Calibri', 'Inter'],
    ['', 'Inter'],
  ])('%s -> %s', (name, family) => {
    expect(familyForPdfFont(name)).toBe(family);
  });
});
