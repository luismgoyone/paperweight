import { useEditor } from '../editor/store';
import { useTools } from '../editor/tools';
import { useSlots } from './Canvas/useSlots';

const banner =
  'flex items-center justify-center gap-3 border-b border-blue-100 bg-blue-50 px-4 py-1.5 text-sm text-blue-900';

/**
 * Offers form filling when the open PDF has fillable fields. On a flat form (no fields), Form
 * fill highlights the boxes it found instead, and this says how that works.
 */
export function FormBanner() {
  const hasForm = useEditor((s) => s.hasForm);
  const currentPage = useEditor((s) => s.currentPage);
  const tool = useTools((s) => s.tool);
  const setTool = useTools((s) => s.setTool);
  const flat = !hasForm && tool === 'form';
  const slots = useSlots(currentPage, flat);
  if (flat) {
    return (
      <div role="note" className={banner}>
        {slots === null
          ? 'Looking for boxes to fill…'
          : slots.length
            ? 'No fillable fields in this PDF. Click a highlighted box to type in it. Missed one? Use Add text (T).'
            : 'No boxes were found on this page. To fill it in, use Add text (T) and click where you want to type.'}
      </div>
    );
  }
  if (!hasForm || tool === 'form') return null;
  return (
    <div role="note" className={banner}>
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
