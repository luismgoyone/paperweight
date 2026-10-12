import type * as mupdf from 'mupdf';
import { LINE_HEIGHT, firstBaselineOffset, fontId, type FontFamily } from '../../shared/fonts';
import type { Op, TextSpec } from '../../shared/types';
import { getFont } from '../fonts';
import { ensureResource, fmt, pageSpaceCm, writeObjectStream } from './content';

// Text drawn into the page content (added text, spec §6 Phase 2; edited text, Phase 5) as a
// tagged section; see content.ts.

/** A font to draw with: its PDF resource, the program, and how characters map to glyphs. */
type DrawFont = {
  resource: string;
  font: mupdf.Font;
  /** Glyph id -> code point, when the program itself can't say (subset fonts). */
  toUnicode?: Map<number, number>;
  /** Glyph id for a code point, or 0 if the font can't draw it. */
  glyph(cp: number): number;
};

/** The original font of edited text (spec §4 case 1), registered by the text.edit op. */
export type OriginalFont = { name: string; font: mupdf.Font; glyphs: Map<number, number> };
const originals = new Map<string, OriginalFont>();

export function setOriginalFont(id: string, font: OriginalFont): void {
  originals.set(id, font);
}

/** Which font each edited text object ended up using (for the substitution notice, spec §4). */
export type TextEditInfo = { fontName: string; usedOriginal: boolean; substitute?: FontFamily };
const editInfo = new Map<string, TextEditInfo>();

export function textEditInfo(id: string): TextEditInfo | undefined {
  return editInfo.get(id);
}

function bundled(spec: TextSpec): DrawFont {
  const id = fontId(spec.style.family, spec.style);
  const font = getFont(id);
  return { resource: `PE-${id}`, font, glyph: (cp) => font.encodeCharacter(cp) };
}

function original(id: string, o: OriginalFont): DrawFont {
  return {
    resource: `PEo-${id}`,
    font: o.font,
    // Only fonts that can't map Unicode themselves (subsets) need an explicit map; MuPDF
    // derives a complete one for the others.
    toUnicode: [...o.glyphs.keys()].some((cp) => o.font.encodeCharacter(cp) <= 0)
      ? new Map([...o.glyphs].map(([cp, gid]) => [gid, cp]))
      : undefined,
    // Glyphs the page already draws with this font, else the font's own lookup (subset fonts
    // often have no usable cmap).
    glyph: (cp) => o.glyphs.get(cp) ?? o.font.encodeCharacter(cp),
  };
}

const canDraw = (f: DrawFont, text: string) =>
  [...text.replace(/\n/g, '')].every((ch) => f.glyph(ch.codePointAt(0)!) > 0);

/** Spec §4: the run's own font when it has every glyph, otherwise the bundled family. */
function chooseFont(id: string, spec: TextSpec): DrawFont {
  const o = spec.style.original ? originals.get(id) : undefined;
  if (o) {
    const candidate = original(id, o);
    const ok = canDraw(candidate, spec.text);
    editInfo.set(
      id,
      ok
        ? { fontName: spec.style.original!.fontName, usedOriginal: true }
        : {
            fontName: spec.style.original!.fontName,
            usedOriginal: false,
            substitute: spec.style.family,
          },
    );
    if (ok) return candidate;
  }
  return bundled(spec);
}

/** A ToUnicode CMap for 2-byte Identity codes (glyph ids). */
function toUnicodeCMap(map: Map<number, number>): string {
  const hex4 = (n: number) => n.toString(16).padStart(4, '0');
  const utf16 = (cp: number) =>
    String.fromCodePoint(cp)
      .split('')
      .map((c) => hex4(c.charCodeAt(0)))
      .join('');
  const entries = [...map].map(([gid, cp]) => `<${hex4(gid)}> <${utf16(cp)}>`);
  let chunks = '';
  // bfchar blocks hold at most 100 entries each.
  for (let i = 0; i < entries.length; i += 100) {
    const block = entries.slice(i, i + 100);
    chunks += `${block.length} beginbfchar\n${block.join('\n')}\nendbfchar\n`;
  }
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${chunks}endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;
}

function buildContent(page: mupdf.PDFPage, f: DrawFont, spec: TextSpec): string {
  const { box, text, style } = spec;
  // Content is drawn in page space: undo the page transform, then flip y back for glyphs.
  const [r, g, bl] = style.color;
  let out = `q\n${pageSpaceCm(page)}\n${fmt(r)} ${fmt(g)} ${fmt(bl)} rg\nBT\n/${f.resource} ${fmt(style.size)} Tf\n`;
  const baseline0 = box.y + firstBaselineOffset(style.family, style.size);
  text.split('\n').forEach((line, i) => {
    const gids = [...line].map((ch) => {
      const gid = f.glyph(ch.codePointAt(0)!);
      if (gid <= 0)
        throw new Error(`${style.family} can't display "${ch}". Remove it or pick another font.`);
      return gid;
    });
    const width = gids.reduce((w, gid) => w + f.font.advanceGlyph(gid) * style.size, 0);
    const x =
      style.align === 'right'
        ? box.x + box.w - width
        : style.align === 'center'
          ? box.x + (box.w - width) / 2
          : box.x;
    const y = baseline0 + i * LINE_HEIGHT * style.size;
    const hex = gids.map((gid) => gid.toString(16).padStart(4, '0')).join('');
    out += `1 0 0 -1 ${fmt(x)} ${fmt(y)} Tm <${hex}> Tj\n`;
  });
  return `${out}ET\nQ\n`;
}

/**
 * Builds the content for a text object. Throws (before anything changes) if the chosen font
 * can't draw a character. Call `commit` to write it.
 */
export function prepareText(
  doc: mupdf.PDFDocument,
  page: mupdf.PDFPage,
  id: string,
  spec: TextSpec,
): { commit(kind: 'add' | 'update'): void } {
  const f = chooseFont(id, spec);
  const content = buildContent(page, f, spec);
  return {
    commit(kind) {
      ensureResource(doc, page, 'Font', f.resource, () => {
        const ref = doc.addFont(f.font);
        // Keep the text extractable (copy, search, screen readers) even when the font program
        // has no usable cmap: map our glyph ids back to Unicode explicitly.
        if (f.toUnicode?.size)
          ref.resolve().put('ToUnicode', doc.addStream(toUnicodeCMap(f.toUnicode), {}));
        return ref;
      });
      writeObjectStream(doc, page, { kind, id, content });
    },
  };
}

type TextOp = Extract<Op, { kind: 'text.add' | 'text.update' | 'text.delete' }>;

export function applyTextOp(doc: mupdf.PDFDocument, op: TextOp): void {
  const page = doc.loadPage(op.page);
  try {
    if (op.kind === 'text.delete') {
      writeObjectStream(doc, page, { kind: 'delete', id: op.id });
      return;
    }
    prepareText(doc, page, op.id, op.spec).commit(op.kind === 'text.add' ? 'add' : 'update');
  } finally {
    page.destroy();
  }
}
