import { useEffect, useId, useState } from 'react';
import { useEditor } from '../../editor/store';

const QUALITIES = [
  { dpi: 72, label: 'Smallest', hint: 'Screen only (72 dpi)' },
  { dpi: 150, label: 'Balanced', hint: 'Good for reading and email (150 dpi)' },
  { dpi: 300, label: 'High quality', hint: 'Good for printing (300 dpi)' },
];

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Spec §6 Phase 6: compress, showing the size before and after. */
export function CompressDialog({ onClose }: { onClose: () => void }) {
  const compress = useEditor((s) => s.compress);
  const saveExport = useEditor((s) => s.saveExport);
  const [dpi, setDpi] = useState(150);
  const [result, setResult] = useState<{
    dpi: number;
    bytes: Uint8Array;
    before: number;
    after: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const current = result?.dpi === dpi ? result : null;

  useEffect(() => {
    let live = true;
    compress(dpi).then(
      (r) => live && setResult({ dpi, ...r }),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [compress, dpi]);

  const saved = current ? current.before - current.after : 0;
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
          Compress PDF
        </h2>
        <div role="radiogroup" aria-label="Image quality" className="mt-4 space-y-2">
          {QUALITIES.map((q) => (
            <label
              key={q.dpi}
              className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm ${dpi === q.dpi ? 'border-blue-600 bg-blue-50' : 'border-slate-200'}`}
            >
              <input
                type="radio"
                name="quality"
                checked={dpi === q.dpi}
                onChange={() => setDpi(q.dpi)}
              />
              <span>
                <span className="font-medium text-slate-900">{q.label}</span>
                <span className="block text-xs text-slate-500">{q.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p
          aria-live="polite"
          data-testid="compress-sizes"
          className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700"
        >
          {error
            ? error
            : current
              ? saved > 0
                ? `${size(current.before)} → ${size(current.after)} (${Math.round((saved / current.before) * 100)}% smaller)`
                : `${size(current.before)}: already as small as it gets`
              : 'Calculating…'}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Images are resampled and fonts trimmed in this tab. Your file isn't uploaded.
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
            disabled={!current}
            onClick={() => {
              if (current) saveExport(current.bytes);
              onClose();
            }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Download compressed
          </button>
        </div>
      </div>
    </div>
  );
}
