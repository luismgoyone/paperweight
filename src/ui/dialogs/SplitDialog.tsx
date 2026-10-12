import { useId, useState } from 'react';
import { useEditor } from '../../editor/store';
import { splitRanges, type PageRange } from '../../shared/ranges';

export function SplitDialog({ pageCount, onClose }: { pageCount: number; onClose: () => void }) {
  const split = useEditor((s) => s.split);
  const [mode, setMode] = useState<'every' | 'ranges'>('every');
  const [every, setEvery] = useState(1);
  const [ranges, setRanges] = useState('');
  const [busy, setBusy] = useState(false);
  const titleId = useId();

  let result: { ranges: PageRange[] } | { error: string };
  try {
    result = {
      ranges:
        mode === 'every' ? splitRanges(pageCount, { every }) : splitRanges(pageCount, { ranges }),
    };
  } catch (e) {
    result = { error: e instanceof Error ? e.message : String(e) };
  }

  const run = async () => {
    if (!('ranges' in result)) return;
    setBusy(true);
    try {
      await split(result.ranges);
      onClose();
    } catch {
      // The store already showed what went wrong; keep the dialog open to retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          Split document
        </h2>
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-3 rounded-md border border-slate-200 p-3 text-sm">
            <input
              type="radio"
              name="split-mode"
              checked={mode === 'every'}
              onChange={() => setMode('every')}
            />
            Every
            <input
              type="number"
              aria-label="Pages per file"
              min={1}
              max={pageCount}
              value={every}
              onChange={(e) => {
                setMode('every');
                setEvery(Number(e.target.value));
              }}
              className="h-8 w-16 rounded-md border border-slate-300 px-2"
            />
            pages
          </label>
          <label className="block rounded-md border border-slate-200 p-3 text-sm">
            <span className="flex items-center gap-3">
              <input
                type="radio"
                name="split-mode"
                checked={mode === 'ranges'}
                onChange={() => setMode('ranges')}
              />
              Custom ranges
            </span>
            <input
              aria-label="Page ranges"
              placeholder="1-3, 5, 8-10"
              value={ranges}
              onChange={(e) => {
                setMode('ranges');
                setRanges(e.target.value);
              }}
              className="mt-2 h-8 w-full rounded-md border border-slate-300 px-2"
            />
          </label>
        </div>
        <p
          aria-live="polite"
          className={`mt-4 rounded-md px-3 py-2 text-sm ${'error' in result ? 'bg-red-50 text-red-800' : 'bg-slate-50 text-slate-700'}`}
        >
          {'error' in result
            ? result.error
            : `${result.ranges.length} file${result.ranges.length === 1 ? '' : 's'}`}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || 'error' in result}
            onClick={() => void run()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Split and download
          </button>
        </div>
      </div>
    </div>
  );
}
