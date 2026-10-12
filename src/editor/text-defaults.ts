import { familyForPdfFont, styleForPdfFont } from '../shared/fonts';
import type { Point, TextRun, TextStyle } from '../shared/types';

/** Distance from a point to a run's box (0 inside). */
function distance(run: TextRun, p: Point): number {
  const { x, y, w, h } = run.bbox;
  const dx = Math.max(x - p.x, 0, p.x - (x + w));
  const dy = Math.max(y - p.y, 0, p.y - (y + h));
  return Math.hypot(dx, dy);
}

export function nearestRun(runs: readonly TextRun[], p: Point): TextRun | undefined {
  let best: TextRun | undefined;
  let bestDistance = Infinity;
  for (const r of runs) {
    const d = distance(r, p);
    if (d < bestDistance) {
      best = r;
      bestDistance = d;
    }
  }
  return best;
}

/** New text looks like the text around it (spec §4). */
export function styleFromRun(run: TextRun): TextStyle {
  return {
    family: familyForPdfFont(run.font),
    size: Math.round(run.size * 10) / 10,
    color: run.color,
    align: 'left',
    ...styleForPdfFont(run.font),
  };
}
