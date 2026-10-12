// The bundled, self-hosted fonts (spec §4). All are SIL OFL 1.1; see public/fonts/licenses.

export const FONT_FAMILIES = [
  'Liberation Sans',
  'Liberation Serif',
  'Liberation Mono',
  'Inter',
  'Noto Sans',
  'Noto Serif',
] as const;

export type FontFamily = (typeof FONT_FAMILIES)[number];
export type FontStyleKey = { bold: boolean; italic: boolean };
export type BundledFont = FontStyleKey & { family: FontFamily };

const STYLES: FontStyleKey[] = [
  { bold: false, italic: false },
  { bold: true, italic: false },
  { bold: false, italic: true },
  { bold: true, italic: true },
];

export const ALL_FONTS: BundledFont[] = FONT_FAMILIES.flatMap((family) =>
  STYLES.map((s) => ({ family, ...s })),
);

function styleSuffix({ bold, italic }: FontStyleKey): string {
  if (bold && italic) return 'BoldItalic';
  if (bold) return 'Bold';
  if (italic) return 'Italic';
  return 'Regular';
}

/** Stable id, also the PostScript-style name used inside generated PDFs. */
export function fontId(family: FontFamily, style: FontStyleKey): string {
  return `${family.replace(/\s+/g, '')}-${styleSuffix(style)}`;
}

/** Path relative to the site root (no leading slash, so it works under any base path). */
export function fontFile(family: FontFamily, style: FontStyleKey): string {
  return `fonts/${fontId(family, style)}.ttf`;
}

/** Maps a PDF font name (possibly subset-prefixed, e.g. "ABCDEF+Arial-BoldMT") to a bundled family. */
export function familyForPdfFont(pdfFontName: string): FontFamily {
  const name = pdfFontName.replace(/^[A-Z]{6}\+/, '').toLowerCase();
  if (/helvetica|arial|arimo|liberationsans|liberation sans/.test(name)) return 'Liberation Sans';
  if (/times|tinos|liberationserif|liberation serif/.test(name)) return 'Liberation Serif';
  if (/courier|cousine|liberationmono|liberation mono/.test(name)) return 'Liberation Mono';
  if (/notoserif|noto serif/.test(name)) return 'Noto Serif';
  if (/notosans|noto sans/.test(name)) return 'Noto Sans';
  return 'Inter';
}

/** Whether a PDF font name looks bold / italic (used for new-text defaults). */
export function styleForPdfFont(pdfFontName: string): FontStyleKey {
  const name = pdfFontName.toLowerCase();
  return { bold: /bold|black|heavy|semibold/.test(name), italic: /italic|oblique/.test(name) };
}

/** Line height of added text, as a multiple of the font size (also used by the editor overlay). */
export const LINE_HEIGHT = 1.2;

// hhea ascender/descender in em, read from the bundled files (same for every style of a family).
// Browsers use these to place the baseline inside a CSS line box, so using them here keeps the
// on-canvas editor and the rendered PDF text in the same place.
const METRICS: Record<FontFamily, { ascent: number; descent: number }> = {
  'Liberation Sans': { ascent: 0.9053, descent: 0.2119 },
  'Liberation Serif': { ascent: 0.8911, descent: 0.2163 },
  'Liberation Mono': { ascent: 0.8325, descent: 0.3003 },
  Inter: { ascent: 0.9688, descent: 0.2412 },
  'Noto Sans': { ascent: 1.069, descent: 0.293 },
  'Noto Serif': { ascent: 1.069, descent: 0.293 },
};

/** Distance from the top of a text box to its first baseline, in points (CSS half-leading model). */
export function firstBaselineOffset(family: FontFamily, size: number): number {
  const { ascent, descent } = METRICS[family];
  return ((LINE_HEIGHT - ascent - descent) / 2 + ascent) * size;
}
