import { useEffect } from 'react';
import { useEditor } from '../editor/store';
import { zoomIn, zoomOut } from '../editor/zoom';

/** Global shortcuts (spec §5). Tool shortcuts arrive with their tools in later phases. */
export function useKeyboard(focusSearch: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const typing =
        e.target instanceof HTMLElement &&
        e.target.closest('input, textarea, [contenteditable=true]');
      const key = e.key.toLowerCase();

      if (mod && key === 's') {
        e.preventDefault();
        void s.download();
      } else if (mod && key === 'f') {
        e.preventDefault();
        focusSearch();
      } else if (mod && (key === '=' || key === '+')) {
        e.preventDefault();
        s.setZoom(zoomIn(s.zoom));
      } else if (mod && key === '-') {
        e.preventDefault();
        s.setZoom(zoomOut(s.zoom));
      } else if (typing) {
        return;
      } else if (mod && key === 'z') {
        e.preventDefault();
        void (e.shiftKey ? s.redo() : s.undo());
      } else if (mod && key === 'y') {
        e.preventDefault();
        void s.redo();
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        s.goToPage(s.currentPage + 1);
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        s.goToPage(s.currentPage - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusSearch]);
}
