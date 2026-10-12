import * as mupdf from 'mupdf';
import { beforeAll, describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { registerImage } from '../../src/engine/images';
import { OpError } from '../../src/engine/ops';
import { renderPageRGBA } from '../../src/engine/render';
import type { Op, Rect } from '../../src/shared/types';
import { fixture } from './helpers';

/** A 40×20 PNG: left half opaque red, right half fully transparent. */
function testPng(): Uint8Array {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 40, 20], true);
  const px = pix.getPixels();
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 40; x++) {
      const i = (y * 40 + x) * 4;
      const opaque = x < 20;
      px[i] = opaque ? 255 : 0;
      px[i + 1] = 0;
      px[i + 2] = 0;
      px[i + 3] = opaque ? 255 : 0;
    }
  }
  return pix.asPNG();
}

function testJpeg(): Uint8Array {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 30, 30], false);
  pix.clear(0);
  return pix.asJPEG(90);
}

beforeAll(() => {
  registerImage('png1', testPng());
  registerImage('jpg1', testJpeg());
});

const add = (id: string, box: Rect, image = 'png1', page = 0): Op => ({
  kind: 'image.add',
  id,
  page,
  box,
  image,
});

function imageBoxes(doc: mupdf.Document, page = 0): Rect[] {
  const boxes: Rect[] = [];
  const stext = doc.loadPage(page).toStructuredText('preserve-images');
  stext.walk({
    onImageBlock([x0, y0, x1, y1]) {
      boxes.push({
        x: Math.round(x0),
        y: Math.round(y0),
        w: Math.round(x1 - x0),
        h: Math.round(y1 - y0),
      });
    },
  });
  return boxes;
}

function session(name = 'simple.pdf') {
  const s = new EngineSession();
  s.open(fixture(name));
  return s;
}

const reopen = (s: EngineSession) => mupdf.Document.openDocument(s.save(), 'application/pdf');

describe('image ops', () => {
  it('places a PNG at the requested box', () => {
    const s = session();
    s.setOps([add('i1', { x: 100, y: 200, w: 120, h: 60 })]);
    expect(imageBoxes(reopen(s))).toEqual([{ x: 100, y: 200, w: 120, h: 60 }]);
  });

  it('places a JPEG', () => {
    const s = session();
    s.setOps([add('i1', { x: 50, y: 50, w: 90, h: 90 }, 'jpg1')]);
    expect(imageBoxes(reopen(s))).toEqual([{ x: 50, y: 50, w: 90, h: 90 }]);
  });

  it('keeps PNG transparency', () => {
    const s = session();
    s.setOps([add('i1', { x: 100, y: 400, w: 200, h: 100 })]);
    const { pixels, width } = renderPageRGBA(reopen(s), 0, 1);
    const at = (x: number, y: number) => [
      ...pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3),
    ];
    expect(at(150, 450)).toEqual([255, 0, 0]); // opaque half
    expect(at(250, 450)).toEqual([255, 255, 255]); // transparent half shows the page
  });

  it('moves and resizes with image.update, and removes with image.delete', () => {
    const s = session();
    const ops: Op[] = [
      add('i1', { x: 100, y: 200, w: 120, h: 60 }),
      {
        kind: 'image.update',
        id: 'i1',
        page: 0,
        box: { x: 300, y: 300, w: 60, h: 30 },
        image: 'png1',
      },
    ];
    s.setOps(ops);
    expect(imageBoxes(s.doc)).toEqual([{ x: 300, y: 300, w: 60, h: 30 }]);
    s.setOps([...ops, { kind: 'image.delete', id: 'i1', page: 0 }]);
    expect(imageBoxes(s.doc)).toEqual([]);
    s.setOps(ops.slice(0, 1));
    expect(imageBoxes(s.doc)).toEqual([{ x: 100, y: 200, w: 120, h: 60 }]);
  });

  it('embeds each image once per document even when placed many times', () => {
    const s = session();
    const one = s.save().length;
    s.setOps([add('a', { x: 0, y: 0, w: 10, h: 10 })]);
    const first = s.save().length;
    s.setOps([
      add('a', { x: 0, y: 0, w: 10, h: 10 }),
      add('b', { x: 50, y: 0, w: 10, h: 10 }),
      add('c', { x: 0, y: 50, w: 10, h: 10 }, 'png1', 1),
    ]);
    const three = s.save().length;
    expect(three - first).toBeLessThan((first - one) / 2);
  });

  it('places images in page space on rotated and offset pages', () => {
    for (const page of [0, 1]) {
      const s = session('rotated.pdf');
      s.setOps([add('i1', { x: 60, y: 80, w: 100, h: 50 }, 'png1', page)]);
      expect(imageBoxes(reopen(s), page)).toEqual([{ x: 60, y: 80, w: 100, h: 50 }]);
    }
  });

  it('rejects unknown images', () => {
    const s = session();
    expect(() => s.setOps([add('i1', { x: 0, y: 0, w: 10, h: 10 }, 'missing')])).toThrow(OpError);
  });
});
