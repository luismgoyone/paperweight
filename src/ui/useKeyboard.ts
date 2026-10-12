import { useEffect } from 'react';
import { translate } from '../editor/objects';
import { useEditor } from '../editor/store';
import { TOOL_SHORTCUTS, useTools } from '../editor/tools';
import { zoomIn, zoomOut } from '../editor/zoom';
import { annotOpFor } from './Canvas/Overlay';

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Global shortcuts (spec §5). */
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
      } else if (!mod && !e.altKey && TOOL_SHORTCUTS[key]) {
        useTools.getState().setTool(TOOL_SHORTCUTS[key]!);
      } else if (e.key === 'Escape') {
        const tools = useTools.getState();
        if (tools.selectedId) tools.select(null);
        else tools.setTool('select');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const selected = s.objects.find((o) => o.id === useTools.getState().selectedId);
        if (!selected) return;
        e.preventDefault();
        useTools.getState().select(null);
        void s.commit(annotOpFor(selected, 'delete'));
      } else if (NUDGE[e.key]) {
        const selected = s.objects.find((o) => o.id === useTools.getState().selectedId);
        if (!selected) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [dx, dy] = NUDGE[e.key]!;
        void s.commit(annotOpFor(translate(selected, dx * step, dy * step), 'update'));
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
