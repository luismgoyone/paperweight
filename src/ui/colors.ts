import type { Color } from '../shared/types';

export const cssColor = ([r, g, b]: Color) =>
  `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

export function hexToColor(hex: string): Color {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function colorToHex([r, g, b]: Color): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export const sameColor = (a: Color, b: Color) => a.every((c, i) => Math.abs(c - b[i]!) < 0.01);
