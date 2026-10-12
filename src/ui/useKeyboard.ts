import { useEffect } from 'react';
import { translate } from '../editor/objects';
import { useEditor } from '../editor/store';
import { TOOL_SHORTCUTS, useTools } from '../editor/tools';
import { zoomIn, zoomOut } from '../editor/zoom';

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
        e.target.closest('input, textarea, select, [contenteditable=true]');
      const key = e.key.toLowerCase();

      if (mod && key === 's') {
        e.preventDefault();
        // Commit whatever is being typed (form fields commit on blur) before saving.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
        // Some browsers treat Backspace on a focused <select> as "go back", losing the document.
        if (e.key === 'Backspace' && e.target instanceof HTMLSelectElement) e.preventDefault();
        return;
      } else if (mod && key === 'z') {
        e.preventDefault();
        void (e.shiftKey ? s.redo() : s.undo());
      } else if (mod && key === 'y') {
        e.preventDefault();
        void s.redo();
      } else if (!mod && !e.altKey && TOOL_SHORTCUTS[key]) {
        const tool = TOOL_SHORTCUTS[key]!;
        if (tool !== 'text' || s.fontsReady) useTools.getState().setTool(tool);
      } else if (e.key === 'Escape') {
        const tools = useTools.getState();
        if (tools.selectedId) tools.select(null);
        else tools.setTool('select');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const selected = s.objects.find((o) => o.id === useTools.getState().selectedId);
        if (!selected) return;
        e.preventDefault();
        useTools.getState().select(null);
        void s.updateObject(selected.id, () => null);
      } else if (NUDGE[e.key] && !e.altKey) {
        const selected = s.objects.find((o) => o.id === useTools.getState().selectedId);
        if (!selected) return;
        e.preventDefault();
        // Held arrows repeat; accumulate and commit a single move when the key is released.
        const step = e.shiftKey ? 10 : 1;
        const [dx, dy] = NUDGE[e.key]!;
        useTools.getState().addNudge(selected.id, dx * step, dy * step);
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        s.goToPage(s.currentPage + 1);
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        s.goToPage(s.currentPage - 1);
      }
    };
    const commitNudge = () => {
      const nudge = useTools.getState().takeNudge();
      if (nudge)
        void useEditor.getState().updateObject(nudge.id, (o) => translate(o, nudge.dx, nudge.dy));
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (NUDGE[e.key]) commitNudge();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', commitNudge);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', commitNudge);
    };
  }, [focusSearch]);
}
