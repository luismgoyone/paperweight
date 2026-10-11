import { memo, useEffect, useRef } from 'react';
import { useEditor } from '../../editor/store';
import type { PageInfo } from '../../shared/types';

// Browsers cap canvas size; stay well under the smallest common limit.
const MAX_CANVAS_PIXELS = 16_000_000;

type Props = { page: PageInfo; zoom: number; version: number; docId: number };

/** One rendered page: a canvas at zoom × devicePixelRatio plus the search-hit overlay. */
export const PageView = memo(function PageView({ page, zoom, version, docId }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const render = useEditor((s) => s.render);
  const hits = useEditor((s) => s.search.hits);
  const activeHit = useEditor((s) => s.search.hits[s.search.active]);

  useEffect(() => {
    const abort = new AbortController();
    const dpr = window.devicePixelRatio || 1;
    let scale = zoom * dpr;
    const pixels = page.width * page.height * scale * scale;
    if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);

    render(page.index, scale, abort.signal).then(
      (bitmap) => {
        const el = canvas.current;
        if (abort.signal.aborted || !el) return bitmap.close();
        el.width = bitmap.width;
        el.height = bitmap.height;
        el.getContext('2d')?.drawImage(bitmap, 0, 0);
        el.dataset.rendered = 'true';
        bitmap.close();
      },
      () => undefined, // Document closed or replaced mid-render; the new one renders itself.
    );
    return () => abort.abort();
  }, [page.index, page.width, page.height, zoom, version, docId, render]);

  return (
    <>
      <canvas
        ref={canvas}
        className="absolute inset-0 h-full w-full"
        aria-label={`Page ${page.index + 1}`}
      />
      {hits
        .filter((h) => h.page === page.index)
        .flatMap((hit) =>
          hit.rects.map((r, i) => (
            <div
              key={`${r.x},${r.y},${i}`}
              data-testid="hit"
              data-active={hit === activeHit || undefined}
              className={
                hit === activeHit
                  ? 'pointer-events-none absolute bg-orange-400/45 ring-1 ring-orange-500'
                  : 'pointer-events-none absolute bg-yellow-300/45'
              }
              style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }}
            />
          )),
        )}
    </>
  );
});
