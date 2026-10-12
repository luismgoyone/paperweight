import type { Point, Rect } from '../shared/types';

/** Chaikin corner cutting (two passes): smooths a drawn stroke, keeping its endpoints. */
export function smoothStroke(points: readonly Point[], passes = 2): Point[] {
  let current = [...points];
  for (let pass = 0; pass < passes && current.length > 2; pass++) {
    const next: Point[] = [current[0]!];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i]!;
      const b = current[i + 1]!;
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(current[current.length - 1]!);
    current = next;
  }
  return current;
}

const SOFT_EDGE = 40;

/**
 * Background removal for photographed signatures (spec §6 Phase 3): pixels lighter than
 * `threshold` become transparent; a soft band just below it fades in to avoid jagged edges.
 */
export function removeBackground(rgba: Uint8ClampedArray, threshold: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const luminance = 0.2126 * out[i]! + 0.7152 * out[i + 1]! + 0.0722 * out[i + 2]!;
    if (luminance >= threshold) out[i + 3] = 0;
    else if (luminance > threshold - SOFT_EDGE) {
      out[i + 3] = Math.round((out[i + 3]! * (threshold - luminance)) / SOFT_EDGE);
    }
  }
  return out;
}

/** Bounding box of pixels that aren't fully transparent, or null if there are none. */
export function trimTransparent(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Rect | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3]! > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Size that fits within `max` on the long edge, keeping aspect; never upscales. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
