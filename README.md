# PDF Editor

A free PDF editor that runs entirely in your browser. **Files never leave your device.**

No ads, no accounts, no tracking, no uploads. You open a PDF, edit it in the tab, and download
the result. Closing the tab leaves nothing behind.

> Status: **Phase 1 (Core)** is live at https://pdf-editor-navy.vercel.app. Phase 2 (markup and
> add text) is in progress (see [Roadmap](#roadmap)).

## Privacy guarantees

These are enforced by checks, not just intentions (spec §8):

| Guarantee               | How it's enforced                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No backend              | Static files only (Vite build on Vercel). There is no server code.                                                                                                                                                                                                                                           |
| No third-party requests | All assets, including the MuPDF WASM engine, are served from the same origin. The CSP (`vercel.json`) only allows `'self'`.                                                                                                                                                                                  |
| No network after load   | A Playwright test opens, edits, searches and downloads a PDF, and fails on **any** request made after the initial page load.                                                                                                                                                                                 |
| Nothing persisted       | The same test asserts `localStorage`, `sessionStorage`, IndexedDB, cookies, Cache Storage and service workers are all empty. An ESLint rule bans `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `navigator.sendBeacon`, `navigator.serviceWorker` and `fetch` to absolute URLs in `src/`. |
| No referrer leakage     | `Referrer-Policy: no-referrer`; a `Permissions-Policy` disables unused browser features.                                                                                                                                                                                                                     |

Security headers:

```
Content-Security-Policy: default-src 'self'; connect-src 'self'; img-src 'self' blob: data:;
  worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
  font-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'
Referrer-Policy: no-referrer
```

## Features (Phase 1)

- Open a PDF with the file picker or by dropping it on the window
- Password-protected PDFs: password prompt with retry
- Damaged PDFs are repaired when possible; otherwise a clear error is shown
- Virtualized viewer (only visible pages ±1 are rendered), smooth on 100+ page documents
- Zoom: fit width, fit page, 50%–400%
- Page thumbnails, page number box, PageUp/PageDown
- Text search with highlighted results (Enter / Shift+Enter to cycle)
- Undo/redo infrastructure (op log with checkpoints)
- Download as `<name>-edited.pdf`; ⌘S / Ctrl+S
- Warning before closing the tab with changes that weren't downloaded
- Automatic recovery if the PDF engine crashes, without losing edits

## Keyboard shortcuts

| Action               | Shortcut                     |
| -------------------- | ---------------------------- |
| Undo / redo          | ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y)   |
| Download             | ⌘S                           |
| Search               | ⌘F, then Enter / Shift+Enter |
| Zoom in / out        | ⌘= / ⌘-                      |
| Next / previous page | PageDown / PageUp            |

## Architecture

```
src/
  engine/   Runs in a Web Worker. MuPDF.js (WASM) behind a Comlink API. No React, no DOM.
  editor/   UI-thread logic: op log + undo/redo, engine client, zoom/virtualization math, store.
  ui/       React components. Never touches MuPDF directly.
  shared/   Types shared by the worker and the UI (the Op union, geometry).
```

Everything that changes the document is an `Op`. The document is "original bytes + ops"; undo
rebuilds from the nearest in-memory checkpoint (every 20 ops) and replays. See the
[design spec](docs/superpowers/specs/2026-10-12-pdf-editor-design.md) for details.

## Development

Requires Node 22+ and **npm 11** (npm 10 has a resolver bug with Vitest 5's peer graph; Node 24
ships npm 11, or run `npx npm@11 install`).

```bash
npm ci                 # install
npm run dev            # dev server at http://localhost:5173
npm test               # unit/integration tests (Vitest; MuPDF runs in Node)
npm run e2e            # end-to-end + privacy tests (Playwright, production build)
npm run lint           # ESLint (incl. privacy rules) + Prettier
npm run typecheck
npm run build          # static site in dist/
npm run fixtures       # regenerate the synthetic test PDFs in tests/fixtures/
```

Run the e2e suite on all browsers with `PW_ALL_BROWSERS=1 npm run e2e`.

UI mockups made with Google Stitch live in [`docs/design/`](docs/design/).

## Roadmap

- [x] **Phase 1: Core**: viewer, search, op log, download, privacy enforcement
- [ ] Phase 2: Markup and add text (annotations, alignment guides)
- [ ] Phase 3: Signatures, forms and images
- [ ] Phase 4: Page management (reorder, rotate, merge, split)
- [ ] Phase 5: Edit existing text in the same font
- [ ] Phase 6: Redact, compress, passwords
- [ ] Phase 7: OCR (Tesseract.js, self-hosted)
- [ ] Phase 8: PDF → Word

## License

[AGPL-3.0-or-later](LICENSE), because the PDF engine, [MuPDF.js](https://mupdf.com/), is AGPL.
The full source is linked from the app ("Source code").

### Third-party licenses

| Component               | License                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| MuPDF.js (`mupdf`)      | AGPL-3.0-or-later                                                                |
| React, Zustand, Comlink | MIT / MIT / Apache-2.0                                                           |
| Bundled fonts           | None yet. Fonts arrive with Phase 2 and will be listed here with their licenses. |
