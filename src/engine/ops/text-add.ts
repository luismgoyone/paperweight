import type * as mupdf from 'mupdf';
import { LINE_HEIGHT, firstBaselineOffset, fontId } from '../../shared/fonts';
import type { Op, TextSpec } from '../../shared/types';
import { getFont } from '../fonts';
import { ensureResource, fmt, pageSpaceCm, writeObjectStream } from './content';

// Added text is rendered into the page content (spec §6 Phase 2) as its own tagged stream;
// see content.ts.

const resourceName = (id: string) => `PE-${id}`;

/** Glyph ids for a line, or throws if the font lacks a character. */
function encode(font: mupdf.Font, family: string, line: string): number[] {
  return [...line].map((ch) => {
    const gid = font.encodeCharacter(ch.codePointAt(0)!);
    if (gid <= 0)
      throw new Error(`${family} can't display "${ch}". Remove it or pick another font.`);
    return gid;
  });
}

function buildContent(page: mupdf.PDFPage, resource: string, spec: TextSpec): string {
  const { box, text, style } = spec;
  const font = getFont(fontId(style.family, style));
  // Content is drawn in page space: undo the page transform, then flip y back for glyphs.
  const [r, g, bl] = style.color;
  let out = `q\n${pageSpaceCm(page)}\n${fmt(r)} ${fmt(g)} ${fmt(bl)} rg\nBT\n/${resource} ${fmt(style.size)} Tf\n`;
  const baseline0 = box.y + firstBaselineOffset(style.family, style.size);
  text.split('\n').forEach((line, i) => {
    const gids = encode(font, style.family, line);
    const width = gids.reduce((w, gid) => w + font.advanceGlyph(gid) * style.size, 0);
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

type TextOp = Extract<Op, { kind: 'text.add' | 'text.update' | 'text.delete' }>;

export function applyTextOp(doc: mupdf.PDFDocument, op: TextOp): void {
  const page = doc.loadPage(op.page);
  try {
    if (op.kind === 'text.delete') {
      writeObjectStream(doc, page, { kind: 'delete', id: op.id });
      return;
    }
    const font = fontId(op.spec.style.family, op.spec.style);
    // Build (and encode) first so an unsupported character rejects the op before any change.
    const content = buildContent(page, resourceName(font), op.spec);
    ensureResource(doc, page, 'Font', resourceName(font), () => doc.addFont(getFont(font)));
    writeObjectStream(doc, page, {
      kind: op.kind === 'text.add' ? 'add' : 'update',
      id: op.id,
      content,
    });
  } finally {
    page.destroy();
  }
}
