import { useEffect, useState } from 'react';
import { usableSlots } from '../../editor/slots';
import { useEditor } from '../../editor/store';
import type { Slot } from '../../shared/types';

/** The fillable boxes on a page of a flat form, or null while they're being found. */
export function useSlots(page: number, enabled: boolean): Slot[] | null {
  const getSlots = useEditor((s) => s.getSlots);
  const getTextRuns = useEditor((s) => s.getTextRuns);
  const objects = useEditor((s) => s.objects);
  const version = useEditor((s) => s.pageVersions[page] ?? 0);
  const docId = useEditor((s) => s.docId);
  // Stored with the page they belong to, so another page's result is never shown.
  const [result, setResult] = useState<{ page: number; slots: Slot[] } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    Promise.all([getSlots(page), getTextRuns(page)]).then(
      ([found, runs]) => {
        if (live) setResult({ page, slots: usableSlots(found, runs, objects, page) });
      },
      () => {
        if (live) setResult({ page, slots: [] });
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, page, version, docId, objects, getSlots, getTextRuns]);
  return enabled && result?.page === page ? result.slots : null;
}
