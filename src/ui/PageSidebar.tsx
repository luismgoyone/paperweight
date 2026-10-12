import { Fragment, memo, useEffect, useRef, useState, type PointerEvent } from 'react';
import { moveOrder, rangeSelect } from '../editor/page-order';
import { SplitDialog } from './dialogs/SplitDialog';
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

type ThumbProps = {
  page: PageInfo;
  version: number;
  docId: number;
  active: boolean;
  selected: boolean;
  dimmed: boolean;
  onPress: (e: PointerEvent<HTMLButtonElement>, index: number) => void;
};

const Thumbnail = memo(function Thumbnail({
  page,
  version,
  docId,
  active,
  selected,
  dimmed,
  onPress,
}: ThumbProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const render = useEditor((s) => s.render);
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
    <li data-thumb={page.index}>
      <button
        ref={button}
        type="button"
        data-testid="thumbnail"
        aria-label={`Go to page ${page.index + 1}`}
        aria-current={active ? 'page' : undefined}
        aria-pressed={selected}
        onPointerDown={(e) => onPress(e, page.index)}
        className={`group relative flex w-full touch-none flex-col items-center gap-1.5 rounded-lg p-2 hover:bg-slate-100 ${dimmed ? 'opacity-40' : ''}`}
      >
        <canvas
          ref={canvas}
          style={{ width: THUMB_WIDTH, height }}
          className={`bg-white shadow-sm ${selected || active ? 'ring-2 ring-blue-600' : 'ring-1 ring-slate-300'}`}
        />
        {selected && (
          <span
            aria-hidden
            className="absolute top-1 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[11px] text-white"
          >
            ✓
          </span>
        )}
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${active ? 'bg-blue-100 text-blue-700' : 'text-slate-500'}`}
        >
          Page {page.index + 1}
        </span>
      </button>
    </li>
  );
});

const toolButton =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-200 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-40';
const icon = (d: string) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={d} />
  </svg>
);

type Drag = { from: number; startY: number; active: boolean; drop: number | null };

export function PageSidebar() {
  const pages = useEditor((s) => s.pages);
  const pageVersions = useEditor((s) => s.pageVersions);
  const docId = useEditor((s) => s.docId);
  const revision = useEditor((s) => s.revision);
  const currentPage = useEditor((s) => s.currentPage);
  const goToPage = useEditor((s) => s.goToPage);
  const commit = useEditor((s) => s.commit);
  const insertDocument = useEditor((s) => s.insertDocument);
  const extractPages = useEditor((s) => s.extractPages);
  // A selection is only valid for the op-log revision it was made at: undo, redo or any edit
  // can move pages, so the same indices may no longer mean the same pages.
  const [selection, setSelection] = useState<{
    docId: number;
    revision: number;
    pages: number[];
    anchor: number;
  }>({
    docId,
    revision,
    pages: [],
    anchor: 0,
  });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Selection belongs to one version of the page list.
  const selected =
    selection.docId === docId && selection.revision === revision ? selection.pages : [];
  const targets = selected.length ? selected : [currentPage];
  const insertAt = Math.max(...targets) + 1;
  const select = (pagesSel: number[], anchor: number) =>
    setSelection({ docId, revision: useEditor.getState().revision, pages: pagesSel, anchor });

  const dropIndexAt = (clientY: number): number => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[data-thumb]') ?? [])];
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return Number(el.dataset.thumb);
    }
    return pages.length;
  };

  const onPress = (e: PointerEvent<HTMLButtonElement>, index: number) => {
    if (e.button !== 0) return;
    if (e.shiftKey) {
      select(rangeSelect(selection.anchor, index), selection.anchor);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      select(
        selected.includes(index) ? selected.filter((p) => p !== index) : [...selected, index],
        index,
      );
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: index, startY: e.clientY, active: false, drop: null });
  };

  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    if (!drag.active && Math.abs(e.clientY - drag.startY) < 6) return;
    if (!drag.active && !selected.includes(drag.from)) select([drag.from], drag.from);
    setDrag({ ...drag, active: true, drop: dropIndexAt(e.clientY) });
  };

  const onUp = () => {
    if (!drag) return;
    setDrag(null);
    if (!drag.active) {
      select([drag.from], drag.from);
      goToPage(drag.from);
      return;
    }
    const moving = selected.includes(drag.from) ? selected : [drag.from];
    const order = drag.drop === null ? null : moveOrder(pages.length, moving, drag.drop);
    if (order) {
      const moved = moving.map((p) => order.indexOf(p));
      // Keep the moved pages selected (at the revision the move creates).
      void commit({ kind: 'page.move', order }).then(() => select(moved, moved[0]!));
    }
  };

  const moveBy = (delta: -1 | 1) => {
    const sorted = [...targets].sort((a, b) => a - b);
    const drop = delta < 0 ? sorted[0]! - 1 : sorted[sorted.length - 1]! + 2;
    if (drop < 0 || drop > pages.length) return;
    const order = moveOrder(pages.length, sorted, drop);
    if (!order) return;
    const moved = sorted.map((p) => order.indexOf(p));
    void commit({ kind: 'page.move', order }).then(() => {
      select(moved, moved[0]!);
      goToPage(moved[0]!);
    });
  };

  // Alt+↑/↓ moves the selected pages. Listen on the window: Safari doesn't focus a thumbnail
  // button when it's clicked, so a listener on the sidebar would never hear the key.
  const moveByRef = useRef(moveBy);
  useEffect(() => {
    moveByRef.current = moveBy;
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      if (
        e.target instanceof HTMLElement &&
        e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable=false])')
      ) {
        return;
      }
      if (document.querySelector('[aria-modal="true"]')) return; // a dialog is open
      e.preventDefault();
      moveByRef.current(e.key === 'ArrowUp' ? -1 : 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const rotate = (by: 90 | 270) => {
    const { objects, showToast } = useEditor.getState();
    void commit({ kind: 'page.rotate', pages: targets, by });
    if (objects.some((o) => targets.includes(o.page))) {
      showToast(
        'Rotated. Items you added on these pages stay on the page but can no longer be edited.',
      );
    }
  };
  const remove = () => {
    void commit({ kind: 'page.delete', pages: targets });
    select([], 0);
  };
  const insertBlank = () => {
    const ref = pages[insertAt - 1] ?? pages[0]!;
    void commit({ kind: 'page.insertBlank', at: insertAt, width: ref.width, height: ref.height });
    goToPage(insertAt);
  };

  return (
    <nav
      aria-label="Pages"
      className="hidden w-48 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 md:block"
    >
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 pt-3 pb-2">
        <h2 className="text-sm font-semibold text-slate-900">Pages</h2>
        <p className="text-xs text-slate-500">{pages.length} total pages</p>
        <div
          role="toolbar"
          aria-label="Page actions"
          className="mt-2 flex flex-wrap gap-0.5 rounded-md border border-slate-200 bg-white p-0.5"
        >
          <button
            type="button"
            className={toolButton}
            aria-label="Rotate left"
            title="Rotate left"
            onClick={() => rotate(270)}
          >
            {icon('M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5')}
          </button>
          <button
            type="button"
            className={toolButton}
            aria-label="Rotate right"
            title="Rotate right"
            onClick={() => rotate(90)}
          >
            {icon('M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5')}
          </button>
          <button
            type="button"
            className={toolButton}
            aria-label="Delete pages"
            title="Delete"
            disabled={targets.length >= pages.length}
            onClick={remove}
          >
            {icon('M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14')}
          </button>
          <button
            type="button"
            className={toolButton}
            aria-label="Insert blank page"
            title="Insert blank page after"
            onClick={insertBlank}
          >
            {icon('M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM12 11v6M9 14h6')}
          </button>
          <button
            type="button"
            className={toolButton}
            aria-label="Insert pages from PDF"
            title="Insert pages from another PDF"
            onClick={() => fileInput.current?.click()}
          >
            {icon('M12 3v12M7 10l5 5 5-5M5 21h14')}
          </button>
          <button
            type="button"
            className={toolButton}
            aria-label="Extract pages"
            title="Extract pages to a new PDF"
            onClick={() => void extractPages(targets)}
          >
            {icon('M12 21V9M7 14l5-5 5 5M5 3h14')}
          </button>
          <button
            type="button"
            className={toolButton}
            aria-label="Split document"
            title="Split into several PDFs"
            disabled={pages.length < 2}
            onClick={() => setSplitOpen(true)}
          >
            {icon('M6 3v6a6 6 0 0 0 6 6 6 6 0 0 1 6 6M18 3v6a6 6 0 0 1-3 5.2')}
          </button>
        </div>
        {selected.length > 0 && (
          <p className="mt-2 text-xs text-blue-700">{selected.length} selected · drag to reorder</p>
        )}
        <input
          ref={fileInput}
          type="file"
          data-testid="insert-pdf-input"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void insertDocument(file, insertAt);
            e.target.value = '';
          }}
        />
      </div>
      <ol
        ref={list}
        className="relative space-y-1 p-2"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
      >
        {pages.map((page, i) => (
          <Fragment key={`${docId}:${i}`}>
            {drag?.active && drag.drop === i && (
              <li aria-hidden data-testid="drop-line" className="h-0.5 rounded bg-blue-600" />
            )}
            <Thumbnail
              page={page}
              version={pageVersions[i] ?? 0}
              docId={docId}
              active={i === currentPage}
              selected={selected.includes(i)}
              dimmed={Boolean(drag?.active && (selected.includes(i) || drag.from === i))}
              onPress={onPress}
            />
          </Fragment>
        ))}
        {drag?.active && drag.drop === pages.length && (
          <li aria-hidden data-testid="drop-line" className="h-0.5 rounded bg-blue-600" />
        )}
      </ol>
      {splitOpen && <SplitDialog pageCount={pages.length} onClose={() => setSplitOpen(false)} />}
    </nav>
  );
}
