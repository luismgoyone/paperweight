import { useEditor } from '../editor/store';
import { FileIcon, ShieldIcon } from './icons';
import { SOURCE_URL } from './TopBar';

export function EmptyState({ onOpen }: { onOpen: () => void }) {
  const error = useEditor((s) => s.error);
  const loading = useEditor((s) => s.status === 'loading');

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border-2 border-dashed border-neutral-300 bg-white px-8 py-14 text-center">
        <FileIcon className="mx-auto h-12 w-12 text-neutral-400" />
        <h1 className="mt-4 text-xl font-semibold text-neutral-900">Drop a PDF here</h1>
        <p className="mt-2 text-sm text-neutral-500">or choose one from your computer</p>
        <button
          type="button"
          onClick={onOpen}
          disabled={loading}
          className="mt-6 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60"
        >
          {loading ? 'Opening…' : 'Open PDF'}
        </button>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-neutral-500">
          <ShieldIcon className="h-4 w-4 text-emerald-600" />
          Your file is opened in this browser tab and never uploaded.
        </p>
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-block text-xs text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline"
        >
          Source code (AGPL)
        </a>
        {error && (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-800"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
