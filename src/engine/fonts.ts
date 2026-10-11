import * as mupdf from 'mupdf';

// Bundled fonts registered by the UI at startup (spec §4). In memory only.
const registry = new Map<string, mupdf.Font>();

export function registerFont(id: string, bytes: Uint8Array): void {
  if (registry.has(id)) return;
  registry.set(id, new mupdf.Font(id, bytes));
}

export function getFont(id: string): mupdf.Font {
  const font = registry.get(id);
  if (!font) throw new Error(`The font "${id}" is not loaded`);
  return font;
}

export function hasFont(id: string): boolean {
  return registry.has(id);
}
