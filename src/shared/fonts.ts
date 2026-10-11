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
