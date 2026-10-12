// Copies Tesseract.js's worker and WASM core into public/ocr/ so OCR is served from our own
// origin (spec §2: no CDNs). Runs before dev and build; the copies are not committed.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const out = new URL('../public/ocr/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const tesseract = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
copyFileSync(join(tesseract, 'dist/worker.min.js'), join(out, 'worker.min.js'));
// LSTM-only cores (we use the LSTM engine); the worker picks one by CPU features.
for (const f of [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
]) {
  copyFileSync(join(core, f), join(out, f));
}
console.log('copied OCR assets to public/ocr/');
