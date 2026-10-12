import type { Color, DocBlock, DocPage, DocRun } from '../shared/types';

// Word export (spec §6 Phase 8) with the `docx` library, loaded only when used. Fidelity is
// best-effort: paragraphs, text styles, alignment, images and simple tables.

const TWIPS_PER_POINT = 20;
const PIXELS_PER_POINT = 96 / 72; // docx sizes images in 96-dpi pixels
const MAX_PAGE = 22 * 72; // Word's largest page side, in points
const MIN_PAGE = 36;
const MARGIN = 36;

// Characters XML 1.0 can't carry (control characters, non-characters, lone surrogates).
// Broken ToUnicode maps decode to these often; the docx library doesn't escape them and
// Word refuses to open a file that contains them.
const INVALID_XML =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const clean = (text: string) => text.replace(INVALID_XML, '');

const hex = ([r, g, b]: Color) =>
  [r, g, b]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();

type Page = {
  width: number;
  height: number;
  margin: number;
  contentWidth: number;
  contentHeight: number;
};

/** The Word page for a PDF page: within Word's size limits, with room left for content. */
function layout(p: DocPage): Page {
  const clamp = (v: number) => Math.min(MAX_PAGE, Math.max(MIN_PAGE, v));
  const width = clamp(p.width);
  const height = clamp(p.height);
  const margin = Math.min(MARGIN, Math.min(width, height) / 8);
  return {
    width,
    height,
    margin,
    contentWidth: width - 2 * margin,
    contentHeight: height - 2 * margin,
  };
}

export async function buildDocx(pages: DocPage[]): Promise<Blob> {
  const docx = await import('docx');
  const {
    AlignmentType,
    Document,
    ImageRun,
    Packer,
    PageOrientation,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = docx;

  const runs = (rs: DocRun[]) =>
    rs.flatMap((r) => {
      const text = clean(r.text);
      return text
        ? [
            new TextRun({
              text,
              size: Math.max(2, Math.round(r.size * 2)), // half-points
              bold: r.bold,
              italics: r.italic,
              color: hex(r.color),
            }),
          ]
        : [];
    });

  const align = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
  };

  const block = (b: DocBlock, page: Page) => {
    switch (b.kind) {
      case 'paragraph':
        return new Paragraph({
          alignment: align[b.align],
          spacing: {
            before: Math.round(Math.min(b.spaceBefore, 72) * TWIPS_PER_POINT * 0.5),
            after: 0,
          },
          children: runs(b.runs),
        });
      case 'image': {
        // Shrink to the content box: an inline image larger than it is clipped or pushed on.
        const fit = Math.min(1, page.contentWidth / b.width, page.contentHeight / b.height);
        return new Paragraph({
          children: [
            new ImageRun({
              type: 'png',
              data: b.png,
              transformation: {
                width: Math.max(1, Math.round(b.width * fit * PIXELS_PER_POINT)),
                height: Math.max(1, Math.round(b.height * fit * PIXELS_PER_POINT)),
              },
            }),
          ],
        });
      }
      case 'table':
        return new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: b.rows.map(
            (row) =>
              new TableRow({
                children: row.map(
                  (cell) => new TableCell({ children: [new Paragraph({ children: runs(cell) })] }),
                ),
              }),
          ),
        });
    }
  };

  const document = new Document({
    creator: 'PDF Editor',
    sections: pages.map((p) => {
      const page = layout(p);
      const twips = (pt: number) => Math.round(pt * TWIPS_PER_POINT);
      const landscape = page.width > page.height;
      return {
        properties: {
          page: {
            // With landscape orientation the library expects the portrait size and swaps it.
            size: {
              width: twips(Math.min(page.width, page.height)),
              height: twips(Math.max(page.width, page.height)),
              orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: twips(page.margin),
              bottom: twips(page.margin),
              left: twips(page.margin),
              right: twips(page.margin),
            },
          },
        },
        children: p.blocks.length
          ? p.blocks.map((b) => block(b, page))
          : [new Paragraph({ children: [] })],
      };
    }),
  });
  return Packer.toBlob(document);
}
