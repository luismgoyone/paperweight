import * as mupdf from 'mupdf';
import { describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { renderPageRGBA } from '../../src/engine/render';
import { fixture } from './helpers';

/** A one-page PDF with a 2400×1600 photo-like image shown 4×2.67 in (600 dpi), stored losslessly. */
function photoPdf(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const w = 2400;
  const h = 1600;
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  const px = pix.getPixels();
  let seed = 7;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = (seed >> 16) % 24;
      const i = (y * w + x) * 3;
      px[i] = (x / w) * 200 + noise;
      px[i + 1] = (y / h) * 200 + noise;
      px[i + 2] = 120 + noise;
    }
  }
  const img = doc.addImage(new mupdf.Image(pix));
  doc.insertPage(
    -1,
    doc.addPage(
      [0, 0, 612, 792],
      0,
      doc.addObject({ XObject: { Im: img } }),
      'q 288 0 0 192 72 500 cm /Im Do Q',
    ),
  );
  return doc.saveToBuffer('garbage,compress').asUint8Array().slice();
}

describe('compress', () => {
  it('downsamples oversized images and makes the file much smaller', () => {
    const input = photoPdf();
    const s = new EngineSession();
    s.open(input);
    const { bytes, before, after } = s.compress({ dpi: 150 });
    expect(before).toBe(s.save().length);
    expect(after).toBe(bytes.length);
    expect(after).toBeLessThan(before / 4);
    // Still renders the same picture, roughly.
    // Compare 16×16 block averages: the per-pixel noise legitimately averages out when the
    // image is resampled, but a flipped, shifted or discoloured picture would not match.
    const blocks = (bytes: Uint8Array) => {
      const { pixels, width, height } = renderPageRGBA(
        mupdf.Document.openDocument(bytes, 'application/pdf'),
        0,
        0.5,
      );
      const out: number[] = [];
      for (let by = 0; by + 16 <= height; by += 16) {
        for (let bx = 0; bx + 16 <= width; bx += 16) {
          for (let c = 0; c < 3; c++) {
            let sum = 0;
            for (let y = by; y < by + 16; y++)
              for (let x = bx; x < bx + 16; x++) sum += pixels[(y * width + x) * 4 + c]!;
            out.push(sum / 256);
          }
        }
      }
      return out;
    };
    const a = blocks(input);
    const b = blocks(bytes);
    const worst = Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
    expect(worst).toBeLessThan(8);
  });

  it('never makes a file bigger', () => {
    const s = new EngineSession();
    s.open(fixture('simple.pdf'));
    const { before, after } = s.compress({ dpi: 150 });
    expect(after).toBeLessThanOrEqual(before);
  });

  it('leaves the open document unchanged', () => {
    const s = new EngineSession();
    s.open(photoPdf());
    const size = s.save().length;
    s.compress({ dpi: 72 });
    expect(s.save().length).toBe(size);
  });
});

describe('passwords on export', () => {
  it('sets an open password and permissions (AES-256)', () => {
    const s = new EngineSession();
    s.open(fixture('simple.pdf'));
    const bytes = s.save({
      security: {
        kind: 'set',
        userPassword: 'open me',
        ownerPassword: 'owner',
        permissions: { print: true, copy: false, edit: false, annotate: true, forms: true },
      },
    });
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    expect(doc.needsPassword()).toBe(true);
    expect(doc.authenticatePassword('wrong')).toBe(0);
    expect(doc.authenticatePassword('open me')).toBeGreaterThan(0);
    expect(doc.hasPermission('print')).toBe(true);
    expect(doc.hasPermission('copy')).toBe(false);
    expect(doc.hasPermission('edit')).toBe(false);
    expect(doc.hasPermission('annotate')).toBe(true);
    expect(doc.countPages()).toBe(3);
  });

  it('can protect with only an owner password (opens freely, restricted)', () => {
    const s = new EngineSession();
    s.open(fixture('simple.pdf'));
    const bytes = s.save({
      security: {
        kind: 'set',
        userPassword: '',
        ownerPassword: 'owner',
        permissions: { print: false, copy: false, edit: false, annotate: false, forms: false },
      },
    });
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    expect(doc.needsPassword()).toBe(false);
    expect(doc.hasPermission('print')).toBe(false);
  });

  it('removes the password from a protected file', () => {
    const s = new EngineSession();
    s.open(fixture('encrypted.pdf'), 'secret');
    const doc = mupdf.Document.openDocument(
      s.save({ security: { kind: 'remove' } }),
      'application/pdf',
    );
    expect(doc.needsPassword()).toBe(false);
    expect(doc.countPages()).toBe(3);
  });

  it('rejects passwords the PDF writer options cannot carry', () => {
    const s = new EngineSession();
    s.open(fixture('simple.pdf'));
    expect(() =>
      s.save({
        security: {
          kind: 'set',
          userPassword: 'a,b',
          ownerPassword: 'x',
          permissions: { print: true, copy: true, edit: true, annotate: true, forms: true },
        },
      }),
    ).toThrow(/comma/);
  });
});

describe('compress keeps enough detail in both directions', () => {
  it('sizes an unevenly stretched image by its larger displayed side', async () => {
    const { downsampleImages } = await import('../../src/engine/compress');
    const doc = new mupdf.PDFDocument();
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 2000, 2000], false);
    const px = pix.getPixels();
    for (let i = 0; i < px.length; i++) px[i] = (i * 31) % 251;
    const img = doc.addImage(new mupdf.Image(pix));
    // Shown 50 pt wide but 500 pt tall: at 72 dpi it needs 500 px vertically.
    doc.insertPage(
      -1,
      doc.addPage(
        [0, 0, 612, 792],
        0,
        doc.addObject({ XObject: { Im: img } }),
        'q 50 0 0 500 72 100 cm /Im Do Q',
      ),
    );
    downsampleImages(doc, 72);
    const obj = doc.findPage(0).get('Resources', 'XObject', 'Im').resolve();
    expect(obj.get('Height').asNumber()).toBeGreaterThanOrEqual(500);
  });
});
