import * as mupdf from 'mupdf';

// Other PDFs the user picked to insert pages from (merge), by key. In memory only (spec §2).
const registry = new Map<string, mupdf.PDFDocument>();

export type RegisterResult =
  | { status: 'ok'; pageCount: number }
  | { status: 'needs-password' | 'wrong-password' }
  | { status: 'error'; message: string };

export function registerDocument(
  key: string,
  bytes: Uint8Array,
  password?: string,
): RegisterResult {
  if (!/^[\w-]+$/.test(key)) throw new Error('Invalid document key');
  let doc: mupdf.PDFDocument | null;
  try {
    doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
  if (!doc) return { status: 'error', message: 'This file is not a PDF.' };
  if (doc.needsPassword()) {
    if (password === undefined) return { status: 'needs-password' };
    if (doc.authenticatePassword(password) === 0) return { status: 'wrong-password' };
  }
  registry.get(key)?.destroy();
  registry.set(key, doc);
  return { status: 'ok', pageCount: doc.countPages() };
}

export function getDocument(key: string): mupdf.PDFDocument {
  const doc = registry.get(key);
  if (!doc) throw new Error('That PDF is no longer available');
  return doc;
}
