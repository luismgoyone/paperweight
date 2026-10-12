import type * as mupdf from 'mupdf';
import type { FieldType, FormField, Op } from '../shared/types';

function fieldType(w: mupdf.PDFWidget): FieldType {
  if (w.isText()) return 'text';
  if (w.isCheckbox()) return 'checkbox';
  if (w.isRadioButton()) return 'radio';
  if (w.isChoice()) return 'choice';
  if (w.getFieldType() === 'signature') return 'signature';
  return 'button';
}

/** The appearance state a checkbox/radio widget switches to when selected. */
function onState(w: mupdf.PDFWidget): string | null {
  const normal = w.getObject().get('AP', 'N');
  let state: string | null = null;
  if (normal.isDictionary()) {
    normal.forEach((_, key) => {
      if (key !== 'Off' && state === null) state = String(key);
    });
  }
  return state;
}

export function listFields(doc: mupdf.Document, pageIndex: number): FormField[] {
  const page = doc.loadPage(pageIndex) as mupdf.PDFPage;
  if (!('getWidgets' in page)) return [];
  return page.getWidgets().map((w) => {
    const [x0, y0, x1, y1] = w.getRect();
    const type = fieldType(w);
    return {
      name: w.getName(),
      type,
      rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      value: w.getValue(),
      readOnly: w.isReadOnly(),
      multiline: type === 'text' && w.isMultiline(),
      maxLen: type === 'text' ? w.getMaxLen() : 0,
      onState: type === 'checkbox' || type === 'radio' ? onState(w) : null,
      options: type === 'choice' ? w.getOptions() : [],
    };
  });
}

export function applyFormSet(doc: mupdf.PDFDocument, op: Extract<Op, { kind: 'form.set' }>): void {
  const widgets: mupdf.PDFWidget[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    for (const w of doc.loadPage(i).getWidgets()) if (w.getName() === op.field) widgets.push(w);
  }
  if (!widgets.length) throw new Error(`There is no field named "${op.field}"`);
  if (widgets.some((w) => w.isReadOnly())) throw new Error(`"${op.field}" is read-only`);

  for (const w of widgets) {
    if (w.isText()) {
      w.setTextValue(String(op.value));
    } else if (w.isCheckbox()) {
      const on = w.getValue() !== 'Off' && w.getValue() !== '';
      if (on !== Boolean(op.value)) w.toggle();
    } else if (w.isRadioButton()) {
      // Selecting one widget of the group turns the others off.
      if (onState(w) === op.value && w.getValue() !== op.value) w.toggle();
    } else if (w.isChoice()) {
      w.setChoiceValue(String(op.value));
    } else {
      throw new Error(`"${op.field}" can't be filled in here`);
    }
    w.update();
  }
}
