import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { listFields } from '../../src/engine/forms';
import { OpError } from '../../src/engine/ops';
import type { Op } from '../../src/shared/types';
import { fixture } from './helpers';

function session() {
  const s = new EngineSession();
  s.open(fixture('form.pdf'));
  return s;
}
const set = (field: string, value: string | boolean): Op => ({ kind: 'form.set', field, value });
const reopen = (s: EngineSession, options = {}) => new mupdf.PDFDocument(s.save(options));
const value = (doc: mupdf.Document, name: string) =>
  listFields(doc, 0).find((f) => f.name === name)!.value;

describe('open', () => {
  it('reports that the document has a form', () => {
    const r = new EngineSession().open(fixture('form.pdf'));
    expect(r.status === 'ok' && r.hasForm).toBe(true);
  });
});

describe('listFields', () => {
  it('lists every widget with its type, value and geometry in document order', () => {
    const fields = listFields(session().doc, 0);
    expect(fields.map((f) => [f.name, f.type])).toEqual([
      ['name', 'text'],
      ['notes', 'text'],
      ['account', 'text'],
      ['dates.signed', 'text'],
      ['subscribe', 'checkbox'],
      ['plan', 'radio'],
      ['plan', 'radio'],
      ['plan', 'radio'],
      ['country', 'choice'],
      ['size', 'choice'],
    ]);
    const notes = fields[1]!;
    expect(notes.multiline).toBe(true);
    expect(notes.rect).toEqual({ x: 180, y: 100, w: 220, h: 52 });
    expect(fields[2]).toMatchObject({ readOnly: true, value: 'ACCT-001' });
    expect(fields.filter((f) => f.type === 'radio').map((f) => f.onState)).toEqual([
      'basic',
      'pro',
      'team',
    ]);
    expect(fields[4]!.onState).toBe('Yes');
    expect(fields[8]!.options).toEqual([
      { label: 'Canada', value: 'Canada' },
      { label: 'Mexico', value: 'Mexico' },
      { label: 'United States', value: 'United States' },
    ]);
    expect(fields[9]!.options).toEqual([
      { label: 'Small', value: 'S' },
      { label: 'Medium', value: 'M' },
      { label: 'Large', value: 'L' },
    ]);
    expect(fields[9]!.value).toBe('S');
  });
});

describe('form.set', () => {
  it('fills text fields, including dotted names', () => {
    const s = session();
    s.setOps([
      set('name', 'Ada Lovelace'),
      set('dates.signed', '2026-10-12'),
      set('notes', 'Line 1\nLine 2'),
    ]);
    const doc = reopen(s);
    expect(value(doc, 'name')).toBe('Ada Lovelace');
    expect(value(doc, 'dates.signed')).toBe('2026-10-12');
    expect(value(doc, 'notes')).toBe('Line 1\nLine 2');
  });

  it('checks and unchecks a checkbox', () => {
    const s = session();
    s.setOps([set('subscribe', true)]);
    expect(value(reopen(s), 'subscribe')).toBe('Yes');
    s.setOps([set('subscribe', true), set('subscribe', false)]);
    expect(value(reopen(s), 'subscribe')).toBe('Off');
  });

  it('selects exactly one radio button', () => {
    const s = session();
    s.setOps([set('plan', 'pro'), set('plan', 'team')]);
    const doc = reopen(s);
    const states = doc
      .loadPage(0)
      .getWidgets()
      .filter((w) => w.getName() === 'plan')
      .map((w) => w.getObject().get('AS').asName());
    expect(states).toEqual(['Off', 'Off', 'team']);
    expect(value(doc, 'plan')).toBe('team');
  });

  it('chooses a dropdown option', () => {
    const s = session();
    s.setOps([set('country', 'Mexico')]);
    expect(value(reopen(s), 'country')).toBe('Mexico');
  });

  it('stores the export value of a dropdown option', () => {
    const s = session();
    s.setOps([set('size', 'M')]);
    const doc = reopen(s);
    expect(value(doc, 'size')).toBe('M');
  });

  it('rejects a radio value that no button has', () => {
    expect(() => session().setOps([set('plan', 'enterprise')])).toThrow(OpError);
  });

  it('rejects read-only and unknown fields without changing anything', () => {
    const s = session();
    expect(() => s.setOps([set('account', 'X')])).toThrow(OpError);
    expect(() => s.setOps([set('nope', 'X')])).toThrow(OpError);
    expect(() => s.setOps([set('', 'X')])).toThrow(OpError);
    expect(value(s.doc, 'account')).toBe('ACCT-001');
  });

  it('undoes field changes', () => {
    const s = session();
    s.setOps([set('name', 'A'), set('name', 'B')]);
    s.setOps([set('name', 'A')]);
    expect(value(s.doc, 'name')).toBe('A');
    s.setOps([]);
    expect(value(s.doc, 'name')).toBe('');
  });

  it('re-renders every page (fields are not tied to a page in the op)', () => {
    expect(session().setOps([set('name', 'A')]).changedPages).toBe('all');
  });
});

describe('flattenForms', () => {
  it('bakes widgets into the page and keeps the filled values visible', () => {
    const s = session();
    s.setOps([set('name', 'Ada Lovelace')]);
    const flat = reopen(s, { flattenForms: true });
    expect(flat.loadPage(0).getWidgets()).toHaveLength(0);
    expect(flat.loadPage(0).toStructuredText('').asText()).toContain('Ada Lovelace');
  });

  it('keeps annotations editable when only the form is flattened', () => {
    const s = session();
    s.setOps([
      set('name', 'A'),
      {
        kind: 'annot.add',
        id: 'n',
        page: 0,
        annot: { type: 'note', at: { x: 10, y: 10 }, text: 'x', color: [1, 1, 0] },
      },
    ]);
    const flat = reopen(s, { flattenForms: true });
    expect(flat.loadPage(0).getAnnotations()).toHaveLength(1);
  });
});
