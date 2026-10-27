import { useRef, useState, type RefObject } from 'react';
import { useEditor } from '../editor/store';
import { ZOOM_STEPS, zoomIn, zoomOut } from '../editor/zoom';
import { SearchBar } from './SearchBar';
import { CompressDialog } from './dialogs/CompressDialog';
import { ProtectDialog } from './dialogs/ProtectDialog';
import {
  ChevronDownIcon,
  DownloadIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  RedoIcon,
  ShieldIcon,
  UndoIcon,
} from './icons';

export const SOURCE_URL = 'https://github.com/luismgoyone/paperweight';

const iconButton =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-40';

function ZoomControl() {
  const zoom = useEditor((s) => s.zoom);
  const zoomMode = useEditor((s) => s.zoomMode);
  const setZoom = useEditor((s) => s.setZoom);
  const setZoomMode = useEditor((s) => s.setZoomMode);
  const value = zoomMode === 'custom' ? String(zoom) : zoomMode;

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className={iconButton}
        aria-label="Zoom out"
        onClick={() => setZoom(zoomOut(zoom))}
      >
        <MinusIcon />
      </button>
      <select
        aria-label="Zoom"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'fit-width' || v === 'fit-page') setZoomMode(v);
          else setZoom(Number(v));
        }}
        className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-sm text-neutral-700 tabular-nums"
      >
        <option value="fit-width">Fit width</option>
        <option value="fit-page">Fit page</option>
        {zoomMode === 'custom' && !ZOOM_STEPS.includes(zoom as (typeof ZOOM_STEPS)[number]) && (
          <option value={String(zoom)}>{Math.round(zoom * 100)}%</option>
        )}
        {ZOOM_STEPS.map((z) => (
          <option key={z} value={String(z)}>
            {z * 100}%
          </option>
        ))}
      </select>
      <button
        type="button"
        className={iconButton}
        aria-label="Zoom in"
        onClick={() => setZoom(zoomIn(zoom))}
      >
        <PlusIcon />
      </button>
    </div>
  );
}

function PageIndicator() {
  const currentPage = useEditor((s) => s.currentPage);
  const count = useEditor((s) => s.pages.length);
  const goToPage = useEditor((s) => s.goToPage);
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <label className="flex items-center gap-1.5 text-sm text-neutral-600">
      Page
      <input
        aria-label="Current page"
        inputMode="numeric"
        value={draft ?? String(currentPage + 1)}
        onFocus={(e) => {
          setDraft(String(currentPage + 1));
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft) {
            goToPage(Number(draft) - 1);
            e.currentTarget.blur();
          }
        }}
        className="h-8 w-12 rounded-md border border-neutral-200 text-center tabular-nums"
      />
      <span className="tabular-nums">/ {count}</span>
    </label>
  );
}

function FileName() {
  const fileName = useEditor((s) => s.fileName);
  const renameFile = useEditor((s) => s.renameFile);
  const [draft, setDraft] = useState<string | null>(null);
  // Removing the focused input can fire a blur; it mustn't commit a cancelled edit.
  const cancelled = useRef(false);

  if (draft !== null) {
    const commit = () => {
      if (!cancelled.current) renameFile(draft);
      setDraft(null);
    };
    return (
      <input
        aria-label="File name"
        autoFocus
        value={draft}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            cancelled.current = true;
            setDraft(null);
          }
        }}
        className="h-8 w-56 rounded-md border border-blue-500 px-2 text-sm text-neutral-900 outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      data-testid="file-name"
      aria-label={`Rename ${fileName}`}
      title={`${fileName} (click to rename)`}
      onClick={() => {
        cancelled.current = false;
        setDraft(fileName.replace(/\.pdf$/i, ''));
      }}
      className="group inline-flex h-8 max-w-56 items-center gap-1.5 rounded-md px-2 text-sm text-neutral-700 hover:bg-neutral-100"
    >
      <span className="truncate">{fileName}</span>
      <PencilIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}

function DownloadButton() {
  const download = useEditor((s) => s.download);
  const hasAnnotations = useEditor((s) => s.objects.some((o) => o.kind === 'annot'));
  const hasForm = useEditor((s) => s.hasForm);
  const exportWord = useEditor((s) => s.exportWord);
  const exportingWord = useEditor((s) => s.exportingWord);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'compress' | 'protect' | null>(null);

  return (
    <div
      className="relative flex"
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
    >
      <button
        type="button"
        onClick={() => void download()}
        title="Download PDF (⌘S)"
        className="inline-flex items-center gap-1.5 rounded-l-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
      >
        <DownloadIcon className="h-4 w-4" />
        Download PDF
      </button>
      <button
        type="button"
        aria-label="More download options"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="rounded-r-lg border-l border-blue-500 bg-blue-600 px-2 text-white hover:bg-blue-700"
      >
        <ChevronDownIcon className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          <button
            role="menuitem"
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100"
            onClick={() => {
              setOpen(false);
              void download();
            }}
          >
            Download PDF
            <span className="block text-xs text-slate-500">Annotations stay editable</span>
          </button>
          <button
            role="menuitem"
            type="button"
            disabled={!hasAnnotations}
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-50"
            onClick={() => {
              setOpen(false);
              void download({ flatten: true });
            }}
          >
            Download flattened
            <span className="block text-xs text-slate-500">
              Annotations become part of the page
            </span>
          </button>
          {hasForm && (
            <button
              role="menuitem"
              type="button"
              className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100"
              onClick={() => {
                setOpen(false);
                void download({ flattenForms: true });
              }}
            >
              Download with form flattened
              <span className="block text-xs text-slate-500">
                Filled fields can no longer be edited
              </span>
            </button>
          )}
          <button
            role="menuitem"
            type="button"
            disabled={exportingWord}
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-50"
            onClick={() => {
              setOpen(false);
              void exportWord();
            }}
          >
            {exportingWord ? 'Creating Word file…' : 'Export to Word (.docx)'}
            <span className="block text-xs text-slate-500">
              Best effort: text, images and simple tables; layout may differ
            </span>
          </button>
          <div className="my-1 border-t border-slate-200" />
          <button
            role="menuitem"
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100"
            onClick={() => {
              setOpen(false);
              setDialog('compress');
            }}
          >
            Compress…
            <span className="block text-xs text-slate-500">
              Smaller file, before and after sizes
            </span>
          </button>
          <button
            role="menuitem"
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100"
            onClick={() => {
              setOpen(false);
              setDialog('protect');
            }}
          >
            Password…
            <span className="block text-xs text-slate-500">
              Protect, restrict, or remove a password
            </span>
          </button>
          <div className="my-1 border-t border-slate-200" />
          <a
            role="menuitem"
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="block w-full rounded-md px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-100"
            onClick={() => setOpen(false)}
          >
            Source code (AGPL)
          </a>
        </div>
      )}
      {dialog === 'compress' && <CompressDialog onClose={() => setDialog(null)} />}
      {dialog === 'protect' && <ProtectDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

export function PrivacyBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
      <ShieldIcon className="h-3.5 w-3.5" />
      Files never leave your device
    </span>
  );
}

export function TopBar({ searchInput }: { searchInput: RefObject<HTMLInputElement> }) {
  const ready = useEditor((s) => s.status === 'ready' || s.pages.length > 0);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4">
      <div className="flex items-center gap-2">
        <img src="/favicon.svg" alt="" className="h-6 w-6" />
        <span className="text-sm font-semibold text-neutral-900">Paperweight</span>
      </div>
      {ready && (
        <>
          <span className="h-5 w-px bg-neutral-200" />
          <FileName />
          <div className="flex items-center">
            <button
              type="button"
              className={iconButton}
              aria-label="Undo"
              title="Undo (⌘Z)"
              disabled={!canUndo}
              onClick={() => void undo()}
            >
              <UndoIcon />
            </button>
            <button
              type="button"
              className={iconButton}
              aria-label="Redo"
              title="Redo (⇧⌘Z)"
              disabled={!canRedo}
              onClick={() => void redo()}
            >
              <RedoIcon />
            </button>
          </div>
          <ZoomControl />
          <PageIndicator />
          <SearchBar inputRef={searchInput} />
        </>
      )}
      <div className="ml-auto flex items-center gap-3">
        <PrivacyBadge />
        {ready && <DownloadButton />}
      </div>
    </header>
  );
}
