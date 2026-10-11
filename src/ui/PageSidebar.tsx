import { memo, useEffect, useRef } from 'react';
import { useEditor } from '../editor/store';
import type { PageInfo } from '../shared/types';

const THUMB_WIDTH = 120;

// In-memory only (spec §3.4); dropped when another document opens.
const cache = new Map<string, ImageBitmap>();
let cacheDoc = -1;

function cached(docId: number, key: string): ImageBitmap | undefined {
  if (docId !== cacheDoc) {
    cache.forEach((b) => b.close());
    cache.clear();
    cacheDoc = docId;
  }
  return cache.get(key);
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
    const key = `${page.index}:${version}`;
    let cancelled = false;
    const draw = (bitmap: ImageBitmap) => {
      el.width = bitmap.width;
      el.height = bitmap.height;
      el.getContext('2d')?.drawImage(bitmap, 0, 0);
    };
    const hit = cached(docId, key);
    if (hit) {
      draw(hit);
      return;
    }
    // Render lazily, only once the thumbnail scrolls into view.
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      const scale = (THUMB_WIDTH * (window.devicePixelRatio || 1)) / page.width;
      render(page.index, scale).then(
        (bitmap) => {
          if (cached(docId, key)) return bitmap.close();
          cache.set(key, bitmap);
          if (!cancelled) draw(bitmap);
        },
        () => undefined,
      );
    });
    observer.observe(target);
    return () => {
      cancelled = true;
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
        className="group flex w-full flex-col items-center gap-1.5 rounded-lg p-2 hover:bg-neutral-100"
      >
        <canvas
          ref={canvas}
          style={{ width: THUMB_WIDTH, height }}
          className={`bg-white shadow-sm ${active ? 'ring-2 ring-blue-600' : 'ring-1 ring-neutral-900/10'}`}
        />
        <span
          className={`text-xs tabular-nums ${active ? 'font-medium text-blue-700' : 'text-neutral-500'}`}
        >
          {page.index + 1}
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
      className="hidden w-44 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white p-2 md:block"
    >
      <ol className="space-y-1">
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
