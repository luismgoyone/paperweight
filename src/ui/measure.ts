import type { TextStyle } from '../shared/types';

let context: CanvasRenderingContext2D | null = null;

export function cssFont(style: TextStyle, sizePx: number): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 700 : 400} ${sizePx}px "${style.family}"`;
}

/** Width in points of the widest line, using the same bundled font files as the PDF. */
export function measureTextWidth(text: string, style: TextStyle): number {
  context ??= document.createElement('canvas').getContext('2d');
  if (!context) return text.length * style.size * 0.5;
  // Measure at a large size for precision, then scale.
  context.font = cssFont(style, 100);
  const widest = Math.max(0, ...text.split('\n').map((line) => context!.measureText(line).width));
  return (widest / 100) * style.size;
}
