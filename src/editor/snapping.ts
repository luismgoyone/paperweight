import type { Rect } from '../shared/types';

/** Something to align with: an existing text run or another added object. */
export type SnapTarget = { x0: number; x1: number; baseline: number };

export type Guide = { axis: 'x' | 'y'; at: number; from: number; to: number };

type Candidate = { delta: number; at: number; target: SnapTarget; edge?: 'left' | 'right' };

function closest(candidates: Candidate[], threshold: number): Candidate | undefined {
  let best: Candidate | undefined;
  for (const c of candidates) {
    if (Math.abs(c.delta) <= threshold && (!best || Math.abs(c.delta) < Math.abs(best.delta)))
      best = c;
  }
  return best;
}

/**
 * Snaps a box's left edge, right edge and baseline (box.y + baselineOffset) to the targets'
 * left/right edges and baselines when within `threshold` points. Snapped values are exact
 * (spec success criterion 2). x and y snap independently.
 */
export function snapBox(
  box: Rect,
  baselineOffset: number,
  targets: readonly SnapTarget[],
  threshold: number,
): { box: Rect; guides: Guide[] } {
  const left = box.x;
  const right = box.x + box.w;
  const baseline = box.y + baselineOffset;

  const xCandidates = targets.flatMap((t) =>
    [t.x0, t.x1].flatMap((edge) => [
      { delta: edge - left, at: edge, target: t, edge: 'left' as const },
      { delta: edge - right, at: edge, target: t, edge: 'right' as const },
    ]),
  );
  const yCandidates = targets.map((t) => ({
    delta: t.baseline - baseline,
    at: t.baseline,
    target: t,
  }));

  const sx = closest(xCandidates, threshold);
  const sy = closest(yCandidates, threshold);
  // Assign exact positions (not "+ delta") so floating-point error can't creep in.
  const snapped: Rect = { ...box };
  if (sx) snapped.x = sx.edge === 'left' ? sx.at : sx.at - box.w;
  if (sy) snapped.y = sy.at - baselineOffset;

  const guides: Guide[] = [];
  if (sx) {
    guides.push({
      axis: 'x',
      at: sx.at,
      from: Math.min(snapped.y, sx.target.baseline - box.h),
      to: Math.max(snapped.y + snapped.h, sx.target.baseline),
    });
  }
  if (sy) {
    guides.push({
      axis: 'y',
      at: sy.at,
      from: Math.min(snapped.x, sy.target.x0),
      to: Math.max(snapped.x + snapped.w, sy.target.x1),
    });
  }
  return { box: snapped, guides };
}
