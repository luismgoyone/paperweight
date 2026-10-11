/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { E2E_CRASH, ENGINE_READY, type EngineApi } from './api';
import { EngineSession } from './document';
import { registerFont } from './fonts';
import { renderPageRGBA, searchDocument } from './render';
import { selectText, textRuns } from './text';

const session = new EngineSession();

const api: EngineApi = {
  async open(bytes, password) {
    return session.open(bytes, password);
  },
  async setOps(ops) {
    const { changedPages } = session.setOps(ops);
    return { changedPages, pages: session.pageInfo() };
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
  async textRuns(page) {
    return textRuns(session.doc, page);
  },
  async selectText(page, a, b) {
    return selectText(session.doc, page, a, b);
  },
  async save() {
    const bytes = session.save();
    return Comlink.transfer(bytes, [bytes.buffer]);
  },
  async close() {
    session.close();
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
