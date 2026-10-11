import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useEditor } from '../editor/store';
import { Viewer } from './Canvas/Viewer';
import { EmptyState } from './EmptyState';
import { PageSidebar } from './PageSidebar';
import { PasswordDialog } from './dialogs/PasswordDialog';
import { Toast } from './Toast';
import { TopBar } from './TopBar';
import { useKeyboard } from './useKeyboard';

function isPdf(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name) || file.type === '';
}

export function App() {
  const engineReady = useEditor((s) => s.engineReady);
  const status = useEditor((s) => s.status);
  const hasDocument = useEditor((s) => s.pages.length > 0);
  const dirty = useEditor((s) => s.dirty);
  const initEngine = useEditor((s) => s.initEngine);
  const openFile = useEditor((s) => s.openFile);
  const showToast = useEditor((s) => s.showToast);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Start the worker immediately so the WASM loads with the page, not after a file is picked.
  useEffect(() => initEngine(), [initEngine]);

  // Spec §6: warn before leaving with changes that haven't been downloaded.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const focusSearch = useCallback(() => searchInput.current?.focus(), []);
  useKeyboard(focusSearch);

  const open = (file: File | undefined) => {
    if (!file) return;
    if (!isPdf(file)) {
      showToast(`"${file.name}" is not a PDF.`);
      return;
    }
    void openFile(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    open(e.dataTransfer.files[0]);
  };

  const showViewer = hasDocument && status !== 'error';

  return (
    <div
      data-testid="drop-zone"
      className="flex h-dvh flex-col bg-neutral-100 text-neutral-900"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {engineReady && <span data-testid="engine-ready" hidden />}
      <input
        ref={fileInput}
        data-testid="file-input"
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          open(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <TopBar searchInput={searchInput} />
      <main className="flex min-h-0 flex-1">
        {showViewer ? (
          <>
            <PageSidebar />
            <Viewer />
            <aside className="hidden w-64 shrink-0 border-l border-neutral-200 bg-white p-4 lg:block">
              <p className="text-sm text-neutral-400">Select something to see its properties.</p>
            </aside>
          </>
        ) : (
          <div className="flex-1">
            <EmptyState onOpen={() => fileInput.current?.click()} />
          </div>
        )}
      </main>
      {status === 'password' && <PasswordDialog />}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-30 m-3 rounded-2xl border-4 border-dashed border-blue-500 bg-blue-500/5" />
      )}
      <Toast />
    </div>
  );
}
