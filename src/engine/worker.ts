/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { E2E_CRASH, ENGINE_READY, type EngineApi } from './api';
import { EngineSession } from './document';
import { registerDocument, retainDocuments } from './documents';
import { textEditInfo } from './ops/text-add';
import { registerFont } from './fonts';
import { listFields } from './forms';
import { imageSize, registerImage, retainImages } from './images';
import { renderPageRGBA, searchDocument } from './render';
import { selectText, textRuns } from './text';

const session = new EngineSession();

const api: EngineApi = {
  async open(bytes, password) {
    return session.open(bytes, password);
  },
  async setOps(ops) {
    const { changedPages } = session.setOps(ops);
    return { changedPages, pages: session.pageInfo(), hasForm: session.hasForm() };
  },
  async render(page, scale) {
    const { width, height, pixels } = renderPageRGBA(session.doc, page, scale);
    const bitmap = await createImageBitmap(
      new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), width, height),
    );
    return Comlink.transfer(bitmap, [bitmap]);
  },
  async search(needle) {
    return searchDocument(session.doc, needle);
  },
  async fields(page) {
    return listFields(session.doc, page);
  },
  async textRuns(page) {
    return textRuns(session.doc, page);
  },
  async selectText(page, a, b) {
    return selectText(session.doc, page, a, b);
  },
  async save(options) {
    const bytes = session.save(options);
    return Comlink.transfer(bytes, [bytes.buffer]);
  },
  async close() {
    session.close();
  },
  async registerImage(key, bytes) {
    registerImage(key, bytes);
    return imageSize(bytes);
  },
  async registerDocument(key, bytes, password) {
    return registerDocument(key, bytes, password);
  },
  async textEditInfo(id) {
    return textEditInfo(id) ?? null;
  },
  async retainDocuments(keys) {
    retainDocuments(keys);
  },
  async extract(pages) {
    const bytes = session.extract(pages);
    return Comlink.transfer(bytes, [bytes.buffer]);
  },
  async retainImages(keys) {
    retainImages(keys);
  },
  async registerFont(id, bytes) {
    registerFont(id, bytes);
  },
};

Comlink.expose(api);

if (import.meta.env.VITE_E2E) {
  self.addEventListener('message', (e) => {
    if (e.data === E2E_CRASH) {
      setTimeout(() => {
        throw new Error('Simulated engine crash');
      });
    }
  });
}
// `mupdf` uses top-level await to load its WASM, so by the time this line runs the
// engine is usable. Tell the UI thread it can start sending requests.
self.postMessage(ENGINE_READY);
