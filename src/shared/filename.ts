const stripPdf = (name: string) =>
  name
    .trim()
    .replace(/\.pdf$/i, '')
    .trim();

/** "invoice.pdf" -> "invoice-edited.pdf" (spec §6, Phase 1). */
export function editedFileName(name: string): string {
  return `${stripPdf(name) || 'document'}-edited.pdf`;
}

/**
 * A name the user typed -> a safe "<name>.pdf", or null when nothing is left.
 * Characters that file systems reject become "-".
 */
export function renamedFileName(input: string): string | null {
  // eslint-disable-next-line no-control-regex
  const base = stripPdf(input.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-'));
  return base ? `${base}.pdf` : null;
}

/** The PDF download keeps a name the user chose; otherwise it marks the copy as edited. */
export function downloadFileName(name: string, renamed: boolean): string {
  return renamed ? name : editedFileName(name);
}
