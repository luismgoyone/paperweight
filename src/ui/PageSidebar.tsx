import { memo, useEffect, useRef } from 'react';
import { useEditor } from '../editor/store';
import type { PageInfo } from '../shared/types';

const THUMB_WIDTH = 120;

// In-memory only (spec §3.4): one bitmap per page, for the current document version.
const cache = new Map<number, { docId: number; version: number; bitmap: ImageBitmap }>();

function lookup(docId: number, page: number, version: number): ImageBitmap | undefined {
  const entry = cache.get(page);
  return entry && entry.docId === docId && entry.version === version ? entry.bitmap : undefined;
}

function store(docId: number, page: number, version: number, bitmap: ImageBitmap): boolean {
  const entry = cache.get(page);
  // Never let a late render from an older document or version replace a newer entry.
  if (entry && (entry.docId > docId || (entry.docId === docId && entry.version >= version))) {
    return false;
  }
  if (entry && entry.docId !== docId) {
    // A new document: drop everything from the old one.
    cache.forEach((e) => e.bitmap.close());
    cache.clear();
  } else {
    entry?.bitmap.close();
  }
  cache.set(page, { docId, version, bitmap });
  return true;
}

const Thumbnail = memo(function Thumbnail({
  page,
  version,
  docId,
  active,
}: {
  page: PageInfo;
  version: number;
  docId: number;
  active: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const render = useEditor((s) => s.render);
  const goToPage = useEditor((s) => s.goToPage);
  const height = (page.height / page.width) * THUMB_WIDTH;

  useEffect(() => {
    const el = canvas.current;
    const target = button.current;
    if (!el || !target) return;
    const abort = new AbortController();
    const draw = (bitmap: ImageBitmap) => {
      el.width = bitmap.width;
      el.height = bitmap.height;
      el.getContext('2d')?.drawImage(bitmap, 0, 0);
    };
    const hit = lookup(docId, page.index, version);
    if (hit) {
      draw(hit);
      return;
    }
    // Render lazily, only once the thumbnail scrolls into view.
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      const scale = (THUMB_WIDTH * (window.devicePixelRatio || 1)) / page.width;
      render(page.index, scale, abort.signal).then(
        (bitmap) => {
          if (!store(docId, page.index, version, bitmap)) return bitmap.close();
          if (!abort.signal.aborted) draw(bitmap);
        },
        () => undefined,
      );
    });
    observer.observe(target);
    return () => {
      abort.abort();
      observer.disconnect();
    };
  }, [page.index, page.width, version, docId, render]);

  useEffect(() => {
    if (active) button.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <li>
      <button
        ref={button}
        type="button"
        data-testid="thumbnail"
        aria-label={`Go to page ${page.index + 1}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => goToPage(page.index)}
        className="group flex w-full flex-col items-center gap-1.5 rounded-lg p-2 hover:bg-slate-100"
      >
        <canvas
          ref={canvas}
          style={{ width: THUMB_WIDTH, height }}
          className={`bg-white shadow-sm ${active ? 'ring-2 ring-blue-600' : 'ring-1 ring-slate-300'}`}
        />
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${active ? 'bg-blue-100 text-blue-700' : 'text-slate-500'}`}
        >
          Page {page.index + 1}
        </span>
      </button>
    </li>
  );
});

export function PageSidebar() {
  const pages = useEditor((s) => s.pages);
  const pageVersions = useEditor((s) => s.pageVersions);
  const docId = useEditor((s) => s.docId);
  const currentPage = useEditor((s) => s.currentPage);

  return (
    <nav
      aria-label="Pages"
      className="hidden w-44 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 md:block"
    >
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 pt-3 pb-2">
        <h2 className="text-sm font-semibold text-slate-900">Pages</h2>
        <p className="text-xs text-slate-500">{pages.length} total pages</p>
      </div>
      <ol className="space-y-1 p-2">
        {pages.map((page, i) => (
          <Thumbnail
            key={`${docId}:${i}`}
            page={page}
            version={pageVersions[i] ?? 0}
            docId={docId}
            active={i === currentPage}
          />
        ))}
      </ol>
    </nav>
  );
}
