/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { ENGINE_READY, type EngineApi } from './api';
import { EngineSession } from './document';
import { renderPageRGBA, searchDocument } from './render';

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
  async save() {
    const bytes = session.save();
    return Comlink.transfer(bytes, [bytes.buffer]);
  },
  async close() {
    session.close();
  },
};

Comlink.expose(api);
// `mupdf` uses top-level await to load its WASM, so by the time this line runs the
// engine is usable. Tell the UI thread it can start sending requests.
self.postMessage(ENGINE_READY);
