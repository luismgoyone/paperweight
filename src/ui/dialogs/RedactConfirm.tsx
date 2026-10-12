import { useId } from 'react';

export function RedactConfirm({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          Apply {count} redaction{count === 1 ? '' : 's'}?
        </h2>
        <p className="mt-3 text-sm text-slate-600">
          This permanently removes the marked content from the PDF: text, images and drawings under
          each area, plus any notes or form fields there, and the page&apos;s hidden accessibility
          text. Black boxes replace it. You can undo until you close the tab, but the downloaded
          file will not contain it. (The document&apos;s title and author are not changed.)
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Redact
          </button>
        </div>
      </div>
    </div>
  );
}
