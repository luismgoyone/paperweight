import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../editor/store';
import { PAGE_GAP, pageAtOffset, pageOffsets, visibleRange } from '../../editor/visible';
import { Overlay } from './Overlay';
import { PageView } from './PageView';

/** The scrolling page stack. Only visible pages ±1 mount a canvas (spec §3.4). */
export function Viewer() {
  const pages = useEditor((s) => s.pages);
  const pageVersions = useEditor((s) => s.pageVersions);
  const docId = useEditor((s) => s.docId);
  const zoom = useEditor((s) => s.zoom);
  const zoomMode = useEditor((s) => s.zoomMode);
  const scrollRequest = useEditor((s) => s.scrollRequest);
  const applyFit = useEditor((s) => s.applyFit);
  const setCurrentPage = useEditor((s) => s.setCurrentPage);
  const clearScrollRequest = useEditor((s) => s.clearScrollRequest);

  const container = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, width: 0, height: 0 });
  const offsets = useMemo(() => pageOffsets(pages, zoom), [pages, zoom]);
  const maxWidth = useMemo(() => Math.max(0, ...pages.map((p) => p.width)) * zoom, [pages, zoom]);
  const lastPage = pages[pages.length - 1];
  const totalHeight = lastPage
    ? offsets[offsets.length - 1]! + lastPage.height * zoom + PAGE_GAP
    : 0;
  const [first, last] = visibleRange(offsets, viewport.top, viewport.height);

  // Track the viewport size; fit modes recompute the zoom from it.
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () =>
      setViewport((v) => ({ ...v, width: el.clientWidth, height: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (viewport.width) applyFit(viewport.width, viewport.height);
  }, [viewport.width, viewport.height, zoomMode, pages, applyFit]);

  // Keep the same spot in the document under the viewport when the zoom changes.
  // The last scroll position we know of. Read this instead of el.scrollTop when the zoom
  // changes: by then the browser may already have clamped scrollTop to the shorter content.
  const lastScrollTop = useRef(0);
  const previous = useRef({ zoom, offsets });
  useLayoutEffect(() => {
    const el = container.current;
    const before = previous.current;
    previous.current = { zoom, offsets };
    if (!el || before.zoom === zoom || before.offsets.length !== offsets.length) return;
    // Anchor on the point a third of the way down the viewport (the one that decides the
    // current page) and keep it on the same page spot; the gaps between pages don't scale.
    const anchor = el.clientHeight / 3;
    const top = lastScrollTop.current;
    const page = pageAtOffset(before.offsets, top + anchor);
    const within = (top + anchor - before.offsets[page]!) / before.zoom;
    el.scrollTop = offsets[page]! + within * zoom - anchor;
    el.scrollLeft = el.scrollLeft * (zoom / before.zoom);
    lastScrollTop.current = el.scrollTop;
    setViewport((v) => ({ ...v, top: el.scrollTop }));
  }, [zoom, offsets]);

  // Scroll requests come from page navigation, thumbnails and search.
  useLayoutEffect(() => {
    const el = container.current;
    if (!el || !scrollRequest) return;
    const top = offsets[scrollRequest.page];
    if (top !== undefined) {
      const within =
        scrollRequest.y === undefined ? -PAGE_GAP : scrollRequest.y * zoom - el.clientHeight / 3;
      const target = Math.max(0, top + within);
      const alreadyVisible =
        scrollRequest.y !== undefined &&
        top + scrollRequest.y * zoom > el.scrollTop + 40 &&
        top + scrollRequest.y * zoom < el.scrollTop + el.clientHeight - 40;
      if (!alreadyVisible) el.scrollTop = target;
      lastScrollTop.current = el.scrollTop;
      setViewport((v) => ({ ...v, top: el.scrollTop }));
    }
    clearScrollRequest();
  }, [scrollRequest, offsets, zoom, clearScrollRequest]);

  const onScroll = () => {
    const el = container.current;
    if (!el) return;
    lastScrollTop.current = el.scrollTop;
    setViewport((v) => ({ ...v, top: el.scrollTop }));
    setCurrentPage(pageAtOffset(offsets, el.scrollTop + el.clientHeight / 3));
  };

  return (
    <div
      ref={container}
      data-testid="viewer"
      onScroll={onScroll}
      className="relative min-w-0 flex-1 overflow-auto bg-slate-100"
    >
      <div
        style={{ height: totalHeight, width: Math.max(maxWidth + 2 * PAGE_GAP, viewport.width) }}
        className="relative"
      >
        {pages.map((page, i) => {
          const width = page.width * zoom;
          const left = Math.max(
            PAGE_GAP,
            (Math.max(viewport.width, maxWidth + 2 * PAGE_GAP) - width) / 2,
          );
          return (
            <div
              key={`${docId}:${i}`}
              data-testid="page"
              data-page={i + 1}
              className="absolute bg-white shadow-sm ring-1 ring-slate-900/10"
              style={{ top: offsets[i], left, width, height: page.height * zoom }}
            >
              {i >= first && i <= last && (
                <>
                  <PageView page={page} zoom={zoom} version={pageVersions[i] ?? 0} docId={docId} />
                  <Overlay page={page} zoom={zoom} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
