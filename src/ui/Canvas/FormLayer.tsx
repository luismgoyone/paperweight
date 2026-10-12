import { useEffect, useState } from 'react';
import { useEditor } from '../../editor/store';
import type { FormField, PageInfo } from '../../shared/types';

// Native inputs over the page's form widgets (spec §6 Phase 3). They're in document order, so
// Tab follows the form's own field order. Values become `form.set` ops on commit: text on blur
// (or Enter), checkboxes, radios and dropdowns immediately. Inputs show their own state right
// away and remount only when their committed value changes (undo, redo), so focus survives.

const isOn = (f: FormField) => f.value !== '' && f.value !== 'Off';

function TextInput({
  field,
  zoom,
  onCommit,
}: {
  field: FormField;
  zoom: number;
  onCommit: (v: string) => void;
}) {
  const [value, setValue] = useState(field.value);
  const fontSize = Math.min(field.multiline ? 12 : field.rect.h * 0.7, 14) * zoom;
  const common = {
    'aria-label': field.name,
    value,
    disabled: field.readOnly,
    maxLength: field.maxLen > 0 ? field.maxLen : undefined,
    onChange: (e: { target: { value: string } }) => setValue(e.target.value),
    onBlur: () => value !== field.value && onCommit(value),
    className:
      'absolute rounded-sm border border-blue-300 bg-blue-50/90 px-1 text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none disabled:border-slate-200 disabled:bg-slate-50/80 disabled:text-slate-500',
    style: {
      left: field.rect.x * zoom,
      top: field.rect.y * zoom,
      width: field.rect.w * zoom,
      height: field.rect.h * zoom,
      fontSize,
    },
  };
  return field.multiline ? (
    <textarea {...common} className={`${common.className} resize-none`} />
  ) : (
    <input
      {...common}
      type="text"
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function FormLayer({ page, zoom }: { page: PageInfo; zoom: number }) {
  const getFields = useEditor((s) => s.getFields);
  const commit = useEditor((s) => s.commit);
  const version = useEditor((s) => s.pageVersions[page.index] ?? 0);
  const [fields, setFields] = useState<FormField[]>([]);

  useEffect(() => {
    let live = true;
    getFields(page.index).then(
      (f) => live && setFields(f),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [getFields, page.index, version]);

  const set = (field: string, value: string | boolean) =>
    void commit({ kind: 'form.set', field, value });

  return (
    // Inputs need their own pointer handling (focus, clicks), not the overlay's tools.
    <div data-testid="form-layer" onPointerDown={(e) => e.stopPropagation()}>
      {fields.map((f, i) => {
        const style = {
          left: f.rect.x * zoom,
          top: f.rect.y * zoom,
          width: f.rect.w * zoom,
          height: f.rect.h * zoom,
        };
        switch (f.type) {
          case 'text':
            return (
              <TextInput
                key={`${i}:${f.value}`}
                field={f}
                zoom={zoom}
                onCommit={(v) => set(f.name, v)}
              />
            );
          case 'checkbox':
            return (
              <input
                key={`${i}:${f.value}`}
                type="checkbox"
                aria-label={f.name}
                defaultChecked={isOn(f)}
                disabled={f.readOnly}
                onChange={(e) => set(f.name, e.target.checked)}
                className="absolute m-0 accent-blue-600"
                style={style}
              />
            );
          case 'radio':
            return (
              <input
                key={`${i}:${f.value}`}
                type="radio"
                name={`field:${f.name}`}
                aria-label={`${f.name}: ${f.onState}`}
                defaultChecked={f.value === f.onState}
                disabled={f.readOnly}
                onChange={() => f.onState && set(f.name, f.onState)}
                className="absolute m-0 accent-blue-600"
                style={style}
              />
            );
          case 'choice':
            return (
              <select
                key={`${i}:${f.value}`}
                aria-label={f.name}
                defaultValue={f.value}
                disabled={f.readOnly}
                onChange={(e) => set(f.name, e.target.value)}
                className="absolute rounded-sm border border-blue-300 bg-blue-50/90 text-slate-900"
                style={{ ...style, fontSize: Math.min(f.rect.h * 0.6, 13) * zoom }}
              >
                <option value="" />
                {f.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
