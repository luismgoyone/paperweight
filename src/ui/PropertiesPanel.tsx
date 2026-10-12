import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EditorObject } from '../editor/objects';
import { useEditor } from '../editor/store';
import { PALETTE, useTools, type ShapeStyle } from '../editor/tools';
import { FONT_FAMILIES, LINE_HEIGHT, type FontFamily } from '../shared/fonts';
import type { AnnotSpec, Color, TextAlign, TextSpec, TextStyle } from '../shared/types';
import { colorToHex, cssColor, hexToColor, sameColor } from './colors';
import { measureTextWidth } from './measure';

// Edits to a selected object go through `updateObject`, which applies the change to the
// latest committed object in order. Continuous controls (sliders, color wheel, size field)
// keep a local value while adjusting and commit once when the adjustment ends (spec §3.3).

function formatSize(points: { width: number; height: number }) {
  const inches = (n: number) => (n / 72).toFixed(2).replace(/\.?0+$/, '');
  const known: Record<string, string> = {
    '612x792': 'Letter',
    '595x842': 'A4',
    '612x1008': 'Legal',
  };
  const name = known[`${Math.round(points.width)}x${Math.round(points.height)}`];
  return `${inches(points.width)} × ${inches(points.height)} in${name ? ` (${name})` : ''}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-slate-200 p-4">
      <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
      <span className="shrink-0">{label}</span>
      {children}
    </label>
  );
}

/** A slider that commits once, when the user lets go. */
function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState<number | null>(null);
  const done = () => {
    if (local !== null && local !== props.value) props.onCommit(local);
    setLocal(null);
  };
  return (
    <Field label={props.label}>
      <input
        aria-label={props.label}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={local ?? props.value}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={done}
        onKeyUp={done}
        onBlur={done}
      />
    </Field>
  );
}

/** Native color input; commits when the picker closes (its `change` event). */
function CustomColor({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: Color;
  onCommit: (c: Color) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => commitRef.current(hexToColor(el.value));
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  return (
    <input
      ref={ref}
      type="color"
      aria-label={label}
      defaultValue={colorToHex(value)}
      key={colorToHex(value)}
      className="h-6 w-7 cursor-pointer rounded border border-slate-300 bg-white p-0"
    />
  );
}

function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: Color;
  onChange: (c: Color) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {PALETTE.map((p) => (
        <button
          key={p.name}
          type="button"
          aria-label={p.name}
          aria-pressed={sameColor(p.color, value)}
          onClick={() => onChange(p.color)}
          className={`h-6 w-6 rounded-full ring-offset-1 ${sameColor(p.color, value) ? 'ring-2 ring-blue-600' : 'ring-1 ring-slate-300'}`}
          style={{ background: cssColor(p.color) }}
        />
      ))}
      <CustomColor label={`Custom ${label.toLowerCase()}`} value={value} onCommit={onChange} />
    </div>
  );
}

const input = 'h-8 rounded-md border border-slate-200 bg-white px-2 text-sm';

function SizeField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState<string | null>(null);
  const done = () => {
    const size = Number(local);
    if (local !== null && size >= 4 && size <= 144 && size !== value) onCommit(size);
    setLocal(null);
  };
  return (
    <input
      aria-label="Font size"
      type="number"
      min={4}
      max={144}
      step={0.5}
      className={`${input} w-20 tabular-nums`}
      value={local ?? String(value)}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => e.key === 'Enter' && done()}
      onPointerUp={() => setTimeout(done)}
    />
  );
}

function TextControls({
  style,
  onChange,
}: {
  style: TextStyle;
  onChange: (patch: Partial<TextStyle>) => void;
}) {
  const toggle = (on: boolean) =>
    `h-8 w-8 rounded-md border text-sm ${on ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`;
  return (
    <>
      <Field label="Font">
        <select
          aria-label="Font"
          className={`${input} w-40`}
          value={style.family}
          onChange={(e) => onChange({ family: e.target.value as FontFamily })}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </Field>
      <Field label="Size">
        <SizeField value={style.size} onCommit={(size) => onChange({ size })} />
      </Field>
      <div className="flex items-center justify-between">
        <div role="group" aria-label="Alignment" className="flex gap-1">
          {(['left', 'center', 'right'] as TextAlign[]).map((a) => (
            <button
              key={a}
              type="button"
              aria-label={`Align ${a}`}
              aria-pressed={style.align === a}
              className={toggle(style.align === a)}
              onClick={() => onChange({ align: a })}
            >
              {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Bold"
            aria-pressed={style.bold}
            className={`${toggle(style.bold)} font-bold`}
            onClick={() => onChange({ bold: !style.bold })}
          >
            B
          </button>
          <button
            type="button"
            aria-label="Italic"
            aria-pressed={style.italic}
            className={`${toggle(style.italic)} italic`}
            onClick={() => onChange({ italic: !style.italic })}
          >
            I
          </button>
        </div>
      </div>
      <ColorPicker
        label="Text color"
        value={style.color}
        onChange={(color) => onChange({ color })}
      />
    </>
  );
}

function StrokeControls({
  value,
  onChange,
  fill,
}: {
  value: ShapeStyle;
  onChange: (s: Partial<ShapeStyle>) => void;
  fill: boolean;
}) {
  return (
    <>
      <ColorPicker
        label="Stroke color"
        value={value.color}
        onChange={(color) => onChange({ color })}
      />
      <Slider
        label="Stroke width"
        value={value.width}
        min={0.5}
        max={12}
        step={0.5}
        onCommit={(width) => onChange({ width })}
      />
      {fill && (
        <Field label="Fill">
          <span className="flex items-center gap-2">
            <input
              aria-label="Fill shape"
              type="checkbox"
              checked={value.fill !== null}
              onChange={(e) => onChange({ fill: e.target.checked ? value.color : null })}
            />
            {value.fill && (
              <CustomColor
                label="Fill color"
                value={value.fill}
                onCommit={(f) => onChange({ fill: f })}
              />
            )}
          </span>
        </Field>
      )}
      <Slider
        label="Opacity"
        value={value.opacity}
        min={0.1}
        max={1}
        step={0.05}
        onCommit={(opacity) => onChange({ opacity })}
      />
    </>
  );
}

/** Re-anchors a text box after a style change so the aligned edge stays put. */
function restyle(spec: TextSpec, style: TextStyle): TextSpec {
  const w = Math.max(4, measureTextWidth(spec.text, style));
  const { box } = spec;
  const x =
    style.align === 'right'
      ? box.x + box.w - w
      : style.align === 'center'
        ? box.x + (box.w - w) / 2
        : box.x;
  return {
    ...spec,
    style,
    box: { ...box, x, w, h: spec.text.split('\n').length * LINE_HEIGHT * style.size },
  };
}

/** Note text: kept locally while typing, committed on blur or when the note is deselected. */
function NoteText({ id, initial }: { id: string; initial: string }) {
  const updateObject = useEditor((s) => s.updateObject);
  const [text, setText] = useState(initial);
  const latest = useRef({ text, initial });
  useEffect(() => {
    latest.current = { text, initial };
  });
  const save = () => {
    const { text: t, initial: i } = latest.current;
    if (t === i) return;
    latest.current = { text: t, initial: t };
    void updateObject(id, (o) =>
      o.kind === 'annot' && o.annot.type === 'note' ? { ...o, annot: { ...o.annot, text: t } } : o,
    );
  };
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => () => saveRef.current(), []);
  return (
    <textarea
      aria-label="Note text"
      autoFocus={!initial}
      rows={4}
      value={text}
      placeholder="Write a note…"
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      className="w-full rounded-md border border-slate-200 p-2 text-sm"
    />
  );
}

const TITLES: Record<string, string> = {
  text: 'Text',
  image: 'Image',
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'Strikethrough',
  ink: 'Drawing',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  note: 'Note',
};

function SelectionControls({ object }: { object: EditorObject }) {
  const updateObject = useEditor((s) => s.updateObject);
  const select = useTools((s) => s.select);
  const patchAnnot = (patch: Partial<Record<string, unknown>>) =>
    void updateObject(object.id, (o) =>
      o.kind === 'annot' ? { ...o, annot: { ...o.annot, ...patch } as AnnotSpec } : o,
    );

  let body: ReactNode;
  if (object.kind === 'text') {
    body = (
      <TextControls
        style={object.spec.style}
        onChange={(patch) =>
          void updateObject(object.id, (o) =>
            o.kind === 'text' ? { ...o, spec: restyle(o.spec, { ...o.spec.style, ...patch }) } : o,
          )
        }
      />
    );
  } else if (object.kind === 'image') {
    body = (
      <p className="text-sm text-slate-600">
        Drag to move. Drag a corner to resize; it keeps its proportions.
      </p>
    );
  } else {
    const a = object.annot;
    if (a.type === 'note') {
      body = (
        <>
          <NoteText key={a.text} id={object.id} initial={a.text} />
          <ColorPicker label="Color" value={a.color} onChange={(color) => patchAnnot({ color })} />
        </>
      );
    } else if (a.type === 'highlight' || a.type === 'underline' || a.type === 'strikeout') {
      body = (
        <>
          <ColorPicker label="Color" value={a.color} onChange={(color) => patchAnnot({ color })} />
          <Slider
            label="Opacity"
            value={a.opacity}
            min={0.1}
            max={1}
            step={0.05}
            onCommit={(opacity) => patchAnnot({ opacity })}
          />
        </>
      );
    } else {
      const stroked = a as Extract<AnnotSpec, { width: number }>;
      const hasFill = stroked.type === 'rect' || stroked.type === 'ellipse';
      body = (
        <StrokeControls
          value={{
            color: stroked.color,
            width: stroked.width,
            opacity: stroked.opacity,
            fill: 'fill' in stroked ? stroked.fill : null,
          }}
          fill={hasFill}
          onChange={(patch) => {
            const { fill, ...rest } = patch;
            patchAnnot(hasFill && 'fill' in patch ? { ...rest, fill } : rest);
          }}
        />
      );
    }
  }

  return (
    <Section title={TITLES[object.kind === 'annot' ? object.annot.type : object.kind]!}>
      {body}
      <button
        type="button"
        onClick={() => {
          select(null);
          void updateObject(object.id, () => null);
        }}
        className="text-sm font-medium text-red-700 hover:text-red-800"
      >
        Delete
      </button>
    </Section>
  );
}

/** Right panel (spec §5): properties for the current selection, or the active tool's defaults. */
export function PropertiesPanel() {
  const pages = useEditor((s) => s.pages);
  const currentPage = useEditor((s) => s.currentPage);
  const objects = useEditor((s) => s.objects);
  const tool = useTools((s) => s.tool);
  const draft = useTools((s) => s.draft);
  const selectedId = useTools((s) => s.selectedId);
  const shape = useTools((s) => s.shape);
  const ink = useTools((s) => s.ink);
  const updateDraftStyle = useTools((s) => s.updateDraftStyle);
  const setShapeStyle = useTools((s) => s.setShapeStyle);
  const setInkStyle = useTools((s) => s.setInkStyle);
  const selected = objects.find((o) => o.id === selectedId);
  const page = pages[currentPage];

  let content: ReactNode;
  if (draft) {
    content = (
      <Section title="Text">
        <TextControls style={draft.spec.style} onChange={updateDraftStyle} />
      </Section>
    );
  } else if (selected) {
    content = <SelectionControls key={selected.id} object={selected} />;
  } else if (tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow') {
    content = (
      <Section title="Shape">
        <StrokeControls
          value={shape}
          onChange={setShapeStyle}
          fill={tool === 'rect' || tool === 'ellipse'}
        />
      </Section>
    );
  } else if (tool === 'ink') {
    content = (
      <Section title="Pen">
        <StrokeControls value={ink} onChange={setInkStyle} fill={false} />
      </Section>
    );
  } else {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
          </svg>
        </div>
        <p className="mt-4 text-sm font-semibold text-slate-900">
          Select something to see its properties
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Or pick a tool above to add text, markup or shapes.
        </p>
      </div>
    );
  }

  return (
    <aside
      data-properties
      aria-label="Properties"
      className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white lg:flex"
    >
      {content}
      {page && (
        <dl className="mt-auto border-t border-slate-200 p-4 text-xs">
          <dt className="mb-2 font-semibold tracking-wide text-slate-500 uppercase">Document</dt>
          <div className="flex justify-between py-1">
            <span className="text-slate-500">Pages</span>
            <span className="text-slate-900 tabular-nums">{pages.length}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-500">Page size</span>
            <span className="text-slate-900 tabular-nums">{formatSize(page)}</span>
          </div>
        </dl>
      )}
    </aside>
  );
}
