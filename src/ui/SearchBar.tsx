import { useState, type RefObject } from 'react';
import { useEditor } from '../editor/store';
import { useTools } from '../editor/tools';
import { ChevronDownIcon, ChevronUpIcon, SearchIcon } from './icons';

export function SearchBar({ inputRef }: { inputRef: RefObject<HTMLInputElement> }) {
  const search = useEditor((s) => s.search);
  const runSearch = useEditor((s) => s.runSearch);
  const nextHit = useEditor((s) => s.nextHit);
  const prevHit = useEditor((s) => s.prevHit);
  const clearSearch = useEditor((s) => s.clearSearch);
  const [query, setQuery] = useState('');

  const summary = !search.searched
    ? ''
    : search.hits.length
      ? `${search.active + 1} of ${search.hits.length}`
      : 'No results';

  return (
    <div className="flex items-center gap-1">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          ref={inputRef}
          type="search"
          aria-label="Search"
          placeholder="Search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) clearSearch();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (query !== search.query || !search.searched) void runSearch(query);
              else if (e.shiftKey) prevHit();
              else nextHit();
            } else if (e.key === 'Escape') {
              setQuery('');
              clearSearch();
            }
          }}
          className="h-8 w-44 rounded-md border border-neutral-200 pr-2 pl-7 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
        />
      </div>
      <span
        data-testid="search-summary"
        aria-live="polite"
        className="min-w-16 text-xs text-neutral-500 tabular-nums"
      >
        {summary}
      </span>
      {search.hits.length > 0 && (
        <button
          type="button"
          onClick={() => {
            // Mark every match (a little padding so nothing peeks out), then review and apply.
            const pad = 1;
            useTools.getState().addRedactMarks(
              search.hits.flatMap((h) =>
                h.rects.map((r) => ({
                  page: h.page,
                  rect: { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad },
                })),
              ),
            );
            useTools.getState().setTool('redact');
          }}
          className="text-xs font-medium whitespace-nowrap text-red-700 hover:text-red-800"
        >
          Redact all matches ({search.hits.length})
        </button>
      )}
      {search.hits.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous result"
            onClick={prevHit}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
          >
            <ChevronUpIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next result"
            onClick={nextHit}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
          >
            <ChevronDownIcon className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
