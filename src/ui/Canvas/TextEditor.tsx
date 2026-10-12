import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTools, type TextDraft } from '../../editor/tools';
import { LINE_HEIGHT } from '../../shared/fonts';
import type { TextSpec, TextStyle } from '../../shared/types';
import { cssColor } from '../colors';
import { cssFont } from '../measure';

type Props = {
  draft: TextDraft;
  zoom: number;
  measure: (text: string, style: TextStyle) => number;
  onCommit: (spec: TextSpec | null) => void;
};

const MIN_WIDTH = 4;

/**
 * Inline editor for added text. Uses the bundled font at the same size, line height and
 * box position as the engine's layout, so committing doesn't move the text.
 */
export function TextEditor({ draft, zoom, measure, onCommit }: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const updateDraftSpec = useTools((s) => s.updateDraftSpec);
  const [text, setText] = useState(draft.spec.text);
  const committed = useRef(false);
  // Set when a press lands in the properties panel. Safari doesn't focus buttons on click, so
  // the blur that follows has no relatedTarget to tell us where focus went.
  const pressedPanel = useRef(false);
  const { box, style } = draft.spec;

  // Auto-width: keep the anchored edge fixed (left, right or center) as the text changes.
  const width = Math.max(MIN_WIDTH, measure(text, style));
  const lines = Math.max(1, text.split('\n').length);
  const x =
    style.align === 'right'
      ? box.x + box.w - width
      : style.align === 'center'
        ? box.x + (box.w - width) / 2
        : box.x;
  const spec: TextSpec = {
    text,
    style,
    box: { x, y: box.y, w: width, h: lines * LINE_HEIGHT * style.size },
  };
  const latest = useRef(spec);
  useLayoutEffect(() => {
    latest.current = spec;
  });

  useEffect(() => {
    area.current?.focus();
    area.current?.select();
  }, []);

  const finish = (cancel = false) => {
    if (committed.current) return;
    committed.current = true;
    onCommit(cancel ? (draft.isNew ? null : draft.spec) : latest.current);
  };
  const finishRef = useRef(finish);
  useLayoutEffect(() => {
    finishRef.current = finish;
  });

  // Clicking anywhere except this editor or the properties panel commits the text.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('[data-properties]')) {
        pressedPanel.current = true;
        return;
      }
      pressedPanel.current = false;
      if (target === area.current) return;
      finishRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  return (
    <textarea
      ref={area}
      aria-label="Text"
      data-testid="text-editor"
      value={text}
      spellCheck={false}
      wrap="off"
      onChange={(e) => {
        setText(e.target.value);
        updateDraftSpec({ text: e.target.value });
      }}
      onBlur={(e) => {
        // Changing font or size in the properties panel keeps the editor open.
        if (
          pressedPanel.current ||
          (e.relatedTarget as Element | null)?.closest('[data-properties]')
        )
          return;
        finish();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          finish();
        }
      }}
      className="absolute resize-none overflow-hidden border-0 p-0 outline outline-1 outline-offset-2 outline-blue-500 focus:outline-blue-600"
      style={{
        left: spec.box.x * zoom,
        top: spec.box.y * zoom,
        width: spec.box.w * zoom + 2,
        height: spec.box.h * zoom,
        font: cssFont(style, style.size * zoom),
        lineHeight: LINE_HEIGHT,
        color: cssColor(style.color),
        textAlign: style.align,
        // Editing existing text: hide the committed copy rendered underneath.
        background: draft.isNew ? 'transparent' : 'white',
        whiteSpace: 'pre',
      }}
    />
  );
}
