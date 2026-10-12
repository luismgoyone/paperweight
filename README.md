# PDF Editor

A free PDF editor that runs entirely in your browser. **Files never leave your device.**

No ads, no accounts, no tracking, no uploads. You open a PDF, edit it in the tab, and download
the result. Closing the tab leaves nothing behind.

> Live at **https://pdf-editor-navy.vercel.app**. Phases 1–7 (viewer, markup, add text,
> signatures, forms, images, page management, editing existing text, redaction, compression,
> passwords, OCR) are built; see the [Roadmap](#roadmap).

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

## Features

### OCR (Phase 7)

- Scanned pages (no text layer) get a **Recognize text (OCR)** button. Tesseract runs in this
  tab and adds an invisible text layer, so the scan can be searched and selected and looks
  exactly the same. English is included. Recognised text is for searching and selecting; it
  isn't edited in place (the scan image would still show the old words), which differs from
  the original spec's "editable via Phase 5".
- The OCR engine and language data (~8 MB) are served from this site and downloaded only the
  first time you use OCR. This is the one exception to "no requests after the page loads":
  those requests are plain downloads of the app's own files and never carry your document.
  Tesseract's defaults (a CDN, and caching data in IndexedDB) are switched off.

### Redact, compress, passwords (Phase 6)

- **Redact**: drag over anything (or "Redact all matches" from search), review the marks, and
  confirm. The content under each area is really removed from the file: text, image pixels,
  drawings, and any notes or form-field values there. Black boxes replace it.
- **Compress** (download menu): resamples oversized images, trims fonts and merges duplicate
  data; shows the size before and after. Never makes a file larger.
- **Password** (download menu): protect with an open password (AES-256) and choose what's
  allowed (printing, copying, editing, comments, forms), or remove the password from a file you
  opened with it. Passwords are never stored.

### Edit existing text (Phase 5)

- **Edit text** (E): hover any line of the PDF's own text, click, type, press Enter. The change
  is made in place: the old glyphs are removed (no white box) and the new text is drawn in the
  **same font**, size, color and baseline. Numbers in a right-aligned column keep their right
  edge, so `$26 → $31` on an invoice lines up exactly.
- If the document's font doesn't contain a character you type (common with subset fonts), a
  metric-compatible bundled font is used instead, and the properties panel says so
  ("Substituted: Arial → Liberation Sans"). Substitution is never silent.
- Edits are line-level: text doesn't reflow into neighbouring lines.

### Pages (Phase 4)

- Reorder by dragging thumbnails (select several with ⌘/Ctrl-click or Shift-click), or Alt+↑/↓.
- Rotate, delete, and insert blank pages; insert all pages of another PDF (merge), including
  password-protected ones.
- Extract the selected pages to a new PDF, or split the document every N pages or by custom
  ranges (one download per part).
- Everything is undoable. Items you added on a page that you later rotate stay on the page but
  are no longer editable.

### Signatures, forms and images (Phase 3)

- **Sign**: draw a signature (smoothed), type it in a script font, or upload a photo of it with
  automatic background removal. Signatures are kept for reuse until you close the tab, and
  never stored.
- **Images**: insert PNG or JPEG images; move them and resize from a corner.
- **Forms**: fill text fields, checkboxes, radio buttons and dropdowns in the document's own tab
  order. Download with the form flattened if it shouldn't be edited again.

### Markup and add text (Phase 2)

- Real PDF annotations: highlight, underline and strikethrough on selected text; pen (ink);
  rectangle and ellipse; line and arrow; sticky notes. All can be selected, moved, recolored and
  deleted, and they stay editable in other PDF apps.
- Add text in a bundled font with size, color, alignment, bold and italic. New text automatically
  takes the font, size and color of the nearest existing text, so additions to an invoice look
  like the invoice.
- Alignment guides snap new and moved objects to the left/right edges and baselines of existing
  text and other objects (exact to within 0.5 pt; hold Alt to move freely).
- Download with annotations editable, or **flattened** into the page.

### Viewer (Phase 1)

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

| Action                                    | Shortcut                     |
| ----------------------------------------- | ---------------------------- |
| Undo / redo                               | ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y)   |
| Download                                  | ⌘S                           |
| Search                                    | ⌘F, then Enter / Shift+Enter |
| Zoom in / out                             | ⌘= / ⌘-                      |
| Next / previous page                      | PageDown / PageUp            |
| Select / Add text / Edit text / Highlight | V / T / E / H                |
| Delete selection                          | Delete                       |
| Nudge selection                           | Arrow keys (Shift: 10 pt)    |
| Finish / cancel text                      | ⌘Enter / Esc                 |
| Move selected pages                       | Alt+↑ / Alt+↓                |

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
- [x] **Phase 2: Markup and add text**: annotations, add text, alignment guides, flatten
- [x] **Phase 3: Signatures, forms and images**
- [x] **Phase 4: Page management**: reorder, rotate, delete, insert, merge, extract, split
- [x] **Phase 5: Edit existing text in the same font**
- [x] **Phase 6: Redact, compress, passwords**
- [x] **Phase 7: OCR** (Tesseract.js, self-hosted)
- [ ] Phase 8: PDF → Word

## License

[AGPL-3.0-or-later](LICENSE), because the PDF engine, [MuPDF.js](https://mupdf.com/), is AGPL.
The full source is linked from the app ("Source code").

### Third-party licenses

| Component                                             | License                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| MuPDF.js (`mupdf`)                                    | AGPL-3.0-or-later                                                 |
| React, Zustand, Comlink                               | MIT / MIT / Apache-2.0                                            |
| Tesseract.js, tesseract.js-core                       | Apache-2.0                                                        |
| Leptonica and image codecs (inside tesseract.js-core) | BSD-2-Clause and others (see the core's license)                  |
| English OCR model (tessdata_fast)                     | Apache-2.0 ([license](public/tessdata/LICENSE-tessdata_fast.txt)) |
| Liberation Sans, Serif, Mono                          | SIL OFL 1.1 ([license](public/fonts/licenses/Liberation-OFL.txt)) |
| Inter                                                 | SIL OFL 1.1 ([license](public/fonts/licenses/Inter-OFL.txt))      |
| Noto Sans, Noto Serif                                 | SIL OFL 1.1 ([license](public/fonts/licenses/Noto-OFL.txt))       |
| Dancing Script, Great Vibes (signatures)              | SIL OFL 1.1 ([licenses](public/fonts/licenses/))                  |

Fonts are self-hosted and loaded once at startup (about 11 MB uncompressed), so the
"no requests after load" guarantee holds while editing.
