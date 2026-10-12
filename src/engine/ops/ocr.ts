import type * as mupdf from 'mupdf';
import { fontId } from '../../shared/fonts';
import type { Op } from '../../shared/types';
import { getFont } from '../fonts';
import { ensureResource, findResource, fmt, pageSpaceCm, writeObjectStream } from './content';

// OCR text layer (spec §6 Phase 7): recognised words drawn as invisible text (render mode 3),
// each stretched to its box, so the scan becomes searchable and selectable but looks the same.

const FAMILY = 'Liberation Sans' as const;
const STYLE = { bold: false, italic: false };
const ASCENT = 0.8; // of the box height, where the baseline sits

export function applyOcrOp(
  doc: mupdf.PDFDocument,
  op: Extract<Op, { kind: 'ocr.addLayer' }>,
): void {
  const page = doc.loadPage(op.page);
  try {
    const id = fontId(FAMILY, STYLE);
    const font = getFont(id);
    const resource = `PE-${id}`;
    let content = `q\n${pageSpaceCm(page)}\nBT\n3 Tr\n`;
    for (const word of op.words) {
      const gids = [...word.text].map((ch) => font.encodeCharacter(ch.codePointAt(0)!));
      // OCR output can contain characters the font lacks; leave those words out.
      if (!gids.length || gids.some((g) => g <= 0) || word.bbox.w <= 0 || word.bbox.h <= 0)
        continue;
      const size = word.bbox.h;
      const natural = gids.reduce((w, gid) => w + font.advanceGlyph(gid) * size, 0);
      const stretch = natural > 0 ? (word.bbox.w / natural) * 100 : 100;
      const hex = gids.map((g) => g.toString(16).padStart(4, '0')).join('');
      content += `/${resource} ${fmt(size)} Tf ${fmt(stretch)} Tz 1 0 0 -1 ${fmt(word.bbox.x)} ${fmt(word.bbox.y + size * ASCENT)} Tm <${hex}> Tj\n`;
    }
    content += 'ET\nQ\n';
    const fontObject = findResource(doc, page, 'Font', resource) ?? doc.addFont(font);
    ensureResource(doc, page, 'Font', resource, () => fontObject);
    writeObjectStream(doc, page, { kind: 'add', id: op.id, content });
  } finally {
    page.destroy();
  }
}
