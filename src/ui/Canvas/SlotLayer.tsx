import { newId } from '../../editor/ids';
import { checkMarkIn, checkSpecForSlot, textSpecForSlot } from '../../editor/slots';
import { useEditor } from '../../editor/store';
import { useTools } from '../../editor/tools';
import type { PageInfo, Slot } from '../../shared/types';
import { measureTextWidth } from '../measure';
import { useSlots } from './useSlots';

/**
 * Click-to-fill on a flat form (no form fields): the boxes found on the page, each a button.
 * A box opens a text box fitted to it; a checkbox toggles an "X". Both are ordinary added text.
 */
export function SlotLayer({ page, zoom }: { page: PageInfo; zoom: number }) {
  const slots = useSlots(page.index, true);
  const commit = useEditor((s) => s.commit);
  const setDraft = useTools((s) => s.setDraft);
  const draft = useTools((s) => s.draft);

  const fill = (slot: Slot) => {
    if (slot.kind === 'text') {
      setDraft({
        id: newId(),
        page: page.index,
        isNew: true,
        original: null,
        spec: textSpecForSlot(slot),
        singleLine: true,
      });
      return;
    }
    const mark = checkMarkIn(slot, useEditor.getState().objects, page.index);
    void commit(
      mark
        ? { kind: 'text.delete', id: mark.id, page: page.index }
        : {
            kind: 'text.add',
            id: newId(),
            page: page.index,
            spec: checkSpecForSlot(slot, measureTextWidth),
          },
    );
  };

  return (
    <>
      {slots?.map((slot) => (
        <button
          key={`${slot.rect.x},${slot.rect.y}`}
          type="button"
          data-testid="slot"
          aria-label={slot.kind === 'text' ? 'Fill box' : 'Toggle checkbox'}
          disabled={!!draft}
          onClick={() => fill(slot)}
          className="absolute rounded-sm border border-blue-400/60 bg-blue-500/5 outline-none hover:border-blue-600 hover:bg-blue-500/15 focus-visible:border-blue-600 focus-visible:bg-blue-500/15 disabled:pointer-events-none"
          style={{
            left: slot.rect.x * zoom,
            top: slot.rect.y * zoom,
            width: slot.rect.w * zoom,
            height: slot.rect.h * zoom,
            cursor: slot.kind === 'text' ? 'text' : 'pointer',
          }}
        />
      ))}
    </>
  );
}
