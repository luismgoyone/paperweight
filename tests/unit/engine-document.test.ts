import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { fixture } from './helpers';

const PDF = 'application/pdf';

describe('EngineSession.open', () => {
  it('opens a PDF and reports page sizes', () => {
    const s = new EngineSession();
    const r = s.open(fixture('simple.pdf'));
    expect(r).toEqual({
      status: 'ok',
      repaired: false,
      pages: [0, 1, 2].map((index) => ({ index, width: 612, height: 792 })),
    });
  });

  it('asks for a password, rejects a wrong one, accepts the right one', () => {
    const s = new EngineSession();
    expect(s.open(fixture('encrypted.pdf'))).toEqual({ status: 'needs-password' });
    expect(s.open(fixture('encrypted.pdf'), 'bad')).toEqual({ status: 'wrong-password' });
    const r = s.open(fixture('encrypted.pdf'), 'secret');
    expect(r.status).toBe('ok');
  });

  it('reports a corrupt file as an error and stays usable', () => {
    const s = new EngineSession();
    const r = s.open(fixture('corrupt.pdf'));
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message.length).toBeGreaterThan(0);
    expect(s.open(fixture('simple.pdf')).status).toBe('ok');
  });

  it('rejects files that are not PDFs', () => {
    const s = new EngineSession();
    const r = s.open(new TextEncoder().encode('hello world'));
    expect(r.status).toBe('error');
  });

  it('throws when accessing the document before opening', () => {
    expect(() => new EngineSession().doc).toThrow(/No document/);
  });
});

describe('EngineSession.save', () => {
  it('produces a byte-valid PDF with the same pages', () => {
    const s = new EngineSession();
    s.open(fixture('simple.pdf'));
    const bytes = s.save();
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(mupdf.Document.openDocument(bytes, PDF).countPages()).toBe(3);
  });

  it('keeps the encryption of a password-protected file', () => {
    const s = new EngineSession();
    s.open(fixture('encrypted.pdf'), 'secret');
    const reopened = mupdf.Document.openDocument(s.save(), PDF);
    expect(reopened.needsPassword()).toBe(true);
    expect(reopened.authenticatePassword('secret')).toBeGreaterThan(0);
  });
});
