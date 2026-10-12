import type { Rect } from '../shared/types';

// OCR with Tesseract.js (spec §6 Phase 7), entirely in the browser. Everything it needs is
// served from our own origin; its defaults (a CDN, and an IndexedDB cache of the language
// data) would break spec §2, so both are overridden. Loaded only when the user asks for OCR.

type TesseractWorker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>;

let worker: Promise<TesseractWorker> | null = null;
// The worker's logger is set once, at creation; each recognize() call points it here.
let reportProgress: (p: number) => void = () => undefined;

function base(path: string): string {
  return new URL(path, document.baseURI).href.replace(/\/$/, '');
}

function getWorker(): Promise<TesseractWorker> {
  worker ??= import('tesseract.js').then(({ createWorker, OEM }) =>
    createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base('ocr/')}/worker.min.js`,
      corePath: base('ocr/'),
      langPath: base('tessdata/'),
      gzip: false,
      cacheMethod: 'none',
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') reportProgress(m.progress);
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
  const w = await getWorker();
  reportProgress = onProgress;
  const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        // Use the line's height for every word, so short words ("a", "on") get full-size
        // text and selections line up.
        const top = line.bbox.y0;
        const height = line.bbox.y1 - line.bbox.y0;
        for (const word of line.words) {
          const text = word.text.trim();
          if (!text || word.confidence < 30) continue;
          const { x0, x1 } = word.bbox;
          words.push({
            text,
            bbox: { x: x0 / scale, y: top / scale, w: (x1 - x0) / scale, h: height / scale },
          });
        }
      }
    }
  }
  return words;
}
