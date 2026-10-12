import type { Color, DocBlock, DocPage, DocRun } from '../shared/types';

// Word export (spec §6 Phase 8) with the `docx` library, loaded only when used. Fidelity is
// best-effort: paragraphs, text styles, alignment, images and simple tables.

const TWIPS_PER_POINT = 20;
const PIXELS_PER_POINT = 96 / 72; // docx sizes images in 96-dpi pixels

const hex = ([r, g, b]: Color) =>
  [r, g, b]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();

export async function buildDocx(pages: DocPage[]): Promise<Blob> {
  const docx = await import('docx');
  const {
    AlignmentType,
    Document,
    ImageRun,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = docx;

  const runs = (rs: DocRun[]) =>
    rs.map(
      (r) =>
        new TextRun({
          text: r.text,
          size: Math.round(r.size * 2), // half-points
          bold: r.bold,
          italics: r.italic,
          color: hex(r.color),
        }),
    );

  const align = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
  };

  const block = (b: DocBlock) => {
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
      case 'image':
        return new Paragraph({
          children: [
            new ImageRun({
              type: 'png',
              data: b.png,
              transformation: {
                width: Math.round(b.width * PIXELS_PER_POINT),
                height: Math.round(b.height * PIXELS_PER_POINT),
              },
            }),
          ],
        });
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
    sections: pages.map((p) => ({
      properties: {
        page: {
          size: {
            width: Math.round(p.width * TWIPS_PER_POINT),
            height: Math.round(p.height * TWIPS_PER_POINT),
          },
          margin: { top: 720, bottom: 720, left: 720, right: 720 },
        },
      },
      children: p.blocks.length ? p.blocks.map(block) : [new Paragraph({ children: [] })],
    })),
  });
  return Packer.toBlob(document);
}
