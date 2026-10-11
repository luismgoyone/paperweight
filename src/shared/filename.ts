/** "invoice.pdf" -> "invoice-edited.pdf" (spec §6, Phase 1). */
export function editedFileName(name: string): string {
  const base = name
    .trim()
    .replace(/\.pdf$/i, '')
    .trim();
  return `${base || 'document'}-edited.pdf`;
}
