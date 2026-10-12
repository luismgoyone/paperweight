import * as mupdf from 'mupdf';

// Image assets (PNG/JPEG bytes) registered by the UI, referenced by key from image ops.
// In memory only (spec §2).
const registry = new Map<string, Uint8Array>();

export function registerImage(key: string, bytes: Uint8Array): void {
  if (!/^[\w-]+$/.test(key)) throw new Error('Invalid image key');
  if (!registry.has(key)) registry.set(key, bytes);
}

export function getImageBytes(key: string): Uint8Array {
  const bytes = registry.get(key);
  if (!bytes) throw new Error('That image is no longer available');
  return bytes;
}

/** Natural size of an image, for the UI's default placement. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } {
  const image = new mupdf.Image(bytes);
  try {
    return { width: image.getWidth(), height: image.getHeight() };
  } finally {
    image.destroy();
  }
}
