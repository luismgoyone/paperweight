import { useEffect } from 'react';
import { useEditor } from '../editor/store';

export function Toast() {
  const toast = useEditor((s) => s.toast);
  const dismiss = useEditor((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismiss, 6000);
    return () => clearTimeout(t);
  }, [toast, dismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
    >
      {toast && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-lg bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg">
          <span>{toast}</span>
          <button
            type="button"
            onClick={dismiss}
            className="text-neutral-300 hover:text-white"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
