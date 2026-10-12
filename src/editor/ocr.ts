import type { Rect } from '../shared/types';

// OCR with Tesseract.js (spec §6 Phase 7), entirely in the browser. Everything it needs is
// served from our own origin; its defaults (a CDN, and an IndexedDB cache of the language
// data) would break spec §2, so both are overridden. Loaded only when the user asks for OCR.

type TesseractWorker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>;

let worker: Promise<TesseractWorker> | null = null;

function base(path: string): string {
  return new URL(path, document.baseURI).href.replace(/\/$/, '');
}

function getWorker(onProgress: (p: number) => void): Promise<TesseractWorker> {
  worker ??= import('tesseract.js').then(({ createWorker, OEM }) =>
    createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base('ocr/')}/worker.min.js`,
      corePath: base('ocr/'),
      langPath: base('tessdata/'),
      gzip: false,
      cacheMethod: 'none',
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') onProgress(m.progress);
      },
    }),
  );
  worker.catch(() => (worker = null));
  return worker;
}

export type OcrWord = { text: string; bbox: Rect };

/**
 * Recognises the words in a page bitmap rendered at `scale` (pixels per point). Boxes are
 * returned in page points. Low-confidence noise is dropped.
 */
export async function recognize(
  bitmap: ImageBitmap,
  scale: number,
  onProgress: (p: number) => void = () => undefined,
): Promise<OcrWord[]> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  const image = await canvas.convertToBlob({ type: 'image/png' });
  const w = await getWorker(onProgress);
  const { data } = await w.recognize(image, {}, { blocks: true, text: false });
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          const text = word.text.trim();
          if (!text || word.confidence < 30) continue;
          const { x0, y0, x1, y1 } = word.bbox;
          words.push({
            text,
            bbox: { x: x0 / scale, y: y0 / scale, w: (x1 - x0) / scale, h: (y1 - y0) / scale },
          });
        }
      }
    }
  }
  return words;
}
