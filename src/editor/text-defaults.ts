import {
  LINE_HEIGHT,
  familyForPdfFont,
  firstBaselineOffset,
  styleForPdfFont,
} from '../shared/fonts';
import type { Point, TextRun, TextSpec, TextStyle } from '../shared/types';

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

/**
 * The editor draft for changing an existing run in place (spec §6 Phase 5). Numbers in a
 * right-aligned column (another run shares the right edge, not the left) keep their right
 * edge; everything else keeps its left edge. The baseline is the run's own.
 */
export function editSpecFor(
  run: TextRun,
  pageRuns: readonly TextRun[],
  measure: (text: string, style: TextStyle) => number,
): TextSpec {
  const columnRight = pageRuns.some(
    (r) => r !== run && Math.abs(r.x1 - run.x1) < 0.5 && Math.abs(r.x0 - run.x0) >= 0.5,
  );
  const style: TextStyle = {
    ...styleFromRun(run),
    size: run.size,
    align: columnRight ? 'right' : 'left',
    original: { fontName: run.font },
  };
  const w = Math.max(1, measure(run.text, style));
  return {
    text: run.text,
    style,
    box: {
      x: columnRight ? run.x1 - w : run.x0,
      y: run.baseline - firstBaselineOffset(style.family, style.size),
      w,
      h: LINE_HEIGHT * style.size,
    },
  };
}
