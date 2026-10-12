import { useEditor } from '../editor/store';
import { useTools } from '../editor/tools';

/** Offers form filling when the open PDF has fillable fields. */
export function FormBanner() {
  const hasForm = useEditor((s) => s.hasForm);
  const tool = useTools((s) => s.tool);
  const setTool = useTools((s) => s.setTool);
  if (!hasForm || tool === 'form') return null;
  return (
    <div
      role="note"
      className="flex items-center justify-center gap-3 border-b border-blue-100 bg-blue-50 px-4 py-1.5 text-sm text-blue-900"
    >
      This PDF has fillable fields.
      <button
        type="button"
        onClick={() => setTool('form')}
        className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
      >
        Fill form
      </button>
    </div>
  );
}
