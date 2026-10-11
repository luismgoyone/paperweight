import { useEditor } from '../editor/store';

function formatSize(points: { width: number; height: number }) {
  const inches = (n: number) => (n / 72).toFixed(2).replace(/\.?0+$/, '');
  const known: Record<string, string> = {
    '612x792': 'Letter',
    '595x842': 'A4',
    '612x1008': 'Legal',
  };
  const name = known[`${Math.round(points.width)}x${Math.round(points.height)}`];
  return `${inches(points.width)} × ${inches(points.height)} in${name ? ` (${name})` : ''}`;
}

/** Right panel (spec §5). Shows selection properties once editing tools exist (Phase 2+). */
export function PropertiesPanel() {
  const pages = useEditor((s) => s.pages);
  const currentPage = useEditor((s) => s.currentPage);
  const page = pages[currentPage];

  return (
    <aside
      aria-label="Properties"
      className="hidden w-64 shrink-0 flex-col border-l border-slate-200 bg-white lg:flex"
    >
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
          </svg>
        </div>
        <p className="mt-4 text-sm font-semibold text-slate-900">
          Select something to see its properties
        </p>
        <p className="mt-1 text-xs text-slate-500">Editing tools arrive in upcoming releases.</p>
      </div>
      {page && (
        <dl className="border-t border-slate-200 p-4 text-xs">
          <dt className="mb-2 font-semibold tracking-wide text-slate-500 uppercase">Document</dt>
          <div className="flex justify-between py-1">
            <span className="text-slate-500">Pages</span>
            <span className="text-slate-900 tabular-nums">{pages.length}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-500">Page size</span>
            <span className="text-slate-900 tabular-nums">{formatSize(page)}</span>
          </div>
        </dl>
      )}
    </aside>
  );
}
