export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
export const PAGE_GUTTER = 48;

export type ZoomMode = 'fit-width' | 'fit-page' | 'custom';

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

export function zoomIn(z: number): number {
  return ZOOM_STEPS.find((s) => s > z + 1e-9) ?? ZOOM_MAX;
}

export function zoomOut(z: number): number {
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-9) ?? ZOOM_MIN;
}

export function fitWidth(pageW: number, viewportW: number, gutter = PAGE_GUTTER): number {
  return clampZoom((viewportW - gutter) / pageW);
}

export function fitPage(
  pageW: number,
  pageH: number,
  viewportW: number,
  viewportH: number,
  gutter = PAGE_GUTTER,
): number {
  return clampZoom(Math.min((viewportW - gutter) / pageW, (viewportH - gutter) / pageH));
}
