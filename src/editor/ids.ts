/** A new object id. Ids end up inside the PDF (annotation /NM, content markers). */
export function newId(): string {
  return crypto.randomUUID();
}
