# PDF Editor: Design Spec

- **Date:** 2026-10-12
- **Status:** Approved for planning
- **Repo:** `~/Documents/Projects/pdf-editor` (public on GitHub, AGPL-3.0)

## 1. Purpose

A free, hosted, browser-only PDF editor for the owner and their friends. It
should cover the everyday Acrobat jobs (markup, adding text, editing existing
text in the same font, signatures, forms, page management, redaction,
compression, passwords, OCR and Word conversion) with **no ads, no accounts, no
tracking, and no file ever leaving the user's device**.

The motivating case is a monthly invoice. Values typed on top of the original
ended up misaligned. The editor must make it easy to change an existing value
in place, keep the original font, and line new text up exactly with the
surrounding columns.

### Success criteria

1. You can open the invoice, change `$26` to another amount in place, and the
   downloaded PDF shows the new value in the same font, size, color and
   baseline position, with no white box or visible patch.
2. New text snaps to the alignment of existing text (left, right or baseline)
   within 0.5 pt.
3. The browser's network panel shows zero requests carrying document data, and
   the app makes no network requests at all after the initial page load.
4. Closing the tab leaves nothing behind: no cookies, localStorage, IndexedDB
   or service-worker caches of documents.
5. Edited PDFs open correctly in Acrobat Reader, macOS Preview and Chrome's
   viewer.

## 2. Non-negotiable constraints

| Constraint | Meaning |
|---|---|
| **No backend** | Static site only. No server code, API routes, database or auth. |
| **Nothing persisted** | No cookies, `localStorage`, `sessionStorage`, IndexedDB or document caching. Signatures and uploaded fonts live in memory for the session only. The downloaded file is the only output. |
| **No third-party network calls** | All assets (WASM, fonts, OCR language data) are self-hosted on the same origin. No CDNs, analytics, error reporting or web fonts from Google. Enforced by CSP (see §8). |
| **Open source** | AGPL-3.0, because MuPDF.js is AGPL. Public GitHub repo, with a "Source code" link in the app. |
| **Desktop first, works everywhere** | Designed for a desktop browser (Chrome, Safari, Firefox, Edge, latest two versions). Usable on tablets. On phones, viewing, signing and form filling must work; the full editing UI is not required there. |

## 3. Architecture

### 3.1 Stack

- **Vite + React 18 + TypeScript (strict)**: SPA, deployed as static files.
- **MuPDF.js** (`mupdf` npm package, WASM): the single PDF engine for parsing,
  rendering, editing, annotations, forms, redaction, encryption, saving and
  text extraction. It runs **inside a Web Worker** so the UI never blocks.
- **Comlink**: typed RPC between the UI thread and the worker.
- **Zustand**: UI and editor state.
- **Tailwind CSS**: styling.
- **Tesseract.js** (Phase 7) and **docx** (Phase 8), both loaded lazily and
  both self-hosted.
- **Vitest** for unit/integration tests (MuPDF runs in Node), **Playwright**
  for end-to-end tests.
- **Hosting:** Vercel as a static deployment, with security headers set in
  `vercel.json`.

### 3.2 Units

Each unit has one job and a narrow interface:

```
src/
  engine/              # Runs in the Web Worker. No React, no DOM.
    worker.ts          # Comlink entry: exposes EngineApi
    document.ts        # open/close/save, password auth, page info
    render.ts          # page -> bitmap at a scale, plus text layout
    ops/               # one file per operation kind (apply(doc, op))
      annotations.ts
      text-add.ts
      text-edit.ts
      images.ts
      forms.ts
      pages.ts
      redact.ts
    fonts.ts           # font matching and the embedded/fallback font registry
    export.ts          # save options: compress, encrypt, flatten
  editor/              # UI-thread domain logic. No rendering.
    history.ts         # op log, undo/redo, checkpoints
    selection.ts
    snapping.ts        # alignment guides against existing text boxes
    engine-client.ts   # Comlink wrapper and request queueing
  ui/                  # React components
    TopBar, Toolbar, PageSidebar, Canvas/, PropertiesPanel, dialogs/
  shared/
    types.ts           # Op union, geometry, font descriptors (shared by worker and UI)
```

The rules:
- `engine/` never imports from `ui/` or `editor/`.
- `ui/` never calls MuPDF directly.
- Everything that changes the document is an `Op`.

### 3.3 Document model: an op log

The source of truth is **the original file bytes plus an ordered list of
`Op`s**.

```ts
type Op =
  | { kind: 'annot.add'; page: number; annot: AnnotSpec }
  | { kind: 'annot.update' | 'annot.delete'; ... }
  | { kind: 'text.add'; page: number; box: Rect; text: string; style: TextStyle }
  | { kind: 'text.edit'; page: number; target: TextRunRef; newText: string; style?: Partial<TextStyle> }
  | { kind: 'image.add'; page: number; box: Rect; png: Uint8Array }   // signatures too
  | { kind: 'form.set'; field: string; value: string | boolean }
  | { kind: 'page.move' | 'page.rotate' | 'page.delete' | 'page.insertBlank' | 'page.insertFrom'; ... }
  | { kind: 'redact'; page: number; rects: Rect[] }
  // abbreviated: each phase adds its ops to the union in shared/types.ts
```

- **Applying:** each committed op is applied right away to the live MuPDF
  document in the worker. The affected pages are then re-rendered.
- **Undo:** rebuild from the nearest checkpoint and replay the ops up to the
  undo point. A checkpoint is the saved document bytes, kept in worker memory,
  taken every 20 ops and before any destructive op (redact, page delete).
  Redo replays the next op again.
- **In-progress interactions** (dragging a box, typing in a text box) live in
  UI state as overlays. They become an op only on commit (blur, Enter, or
  mouse-up).
- **Export:** `doc.saveToBuffer(options)` produces the final PDF bytes. The UI
  then triggers a download via a Blob URL.

### 3.4 Rendering

- Each page is rendered by MuPDF to an `ImageBitmap` at device-pixel-ratio ×
  zoom, then drawn to a `<canvas>`.
- Rendering is virtualized: only visible pages ±1 are rendered. Thumbnails are
  rendered at a low scale and cached in memory.
- A DOM/SVG **overlay layer** sits above each canvas for:
  - selection boxes, handles and alignment guides;
  - live text editing;
  - hit-testing of existing text runs. The engine returns structured text
    (`page.toStructuredText()`) with run boxes, font name, size and color.

## 4. Fonts: the "same font" problem

This is the core of the product, so the policy is explicit.

**Editing existing text (`text.edit`):**
1. **Embedded font has the glyphs** (the normal case for edits like
   `$26 → $31`): rewrite the text run in the page content stream using the
   embedded font. The result matches exactly.
2. **Embedded font is a subset without the glyphs:** use the bundled font that
   matches by name and metrics (table below). Apply the new run in that font at
   the same size, color and baseline.
3. **No match:** use the user's choice from the properties panel. The user can
   pick any bundled font or **load a local `.ttf` or `.otf`** (in memory only).
4. **Whenever case 2 or 3 applies,** the properties panel shows a visible
   "Substituted: Arial → Liberation Sans" notice. Substitution is never silent.

**Bundled metric-compatible fonts** (open licensed, self-hosted):

| PDF font family | Bundled replacement |
|---|---|
| Helvetica / Arial | Liberation Sans |
| Times / Times New Roman | Liberation Serif |
| Courier / Courier New | Liberation Mono |
| Calibri | Carlito |
| Cambria | Caladea |
| (general UI choices) | Inter, Noto Sans, Noto Serif |
| (typed signatures) | 2–3 script fonts, e.g. Dancing Script, Great Vibes |

**Adding new text (`text.add`):** the default font and size are taken from the
nearest existing text run, so new text on an invoice automatically looks like
the invoice.

**Scope limit:** edits are line-level. Changing a run can widen or narrow that
line, but text does **not reflow** into neighbouring lines or paragraphs.
Paragraph reflow is out of scope (§11).

## 5. UI

Layout (light mode, neutral palette, one blue accent):

- **Top bar:** app name, file name, undo/redo, zoom, a "Files never leave your
  device" badge, and the primary **Download PDF** button.
- **Left sidebar:** page thumbnails with drag-to-reorder, plus add, rotate and
  delete actions.
- **Toolbar** (grouped): Select | Edit text, Add text | Highlight, Underline,
  Strikethrough, Pen, Shapes, Arrow, Note | Sign, Form fill, Image | Redact.
  Phases add their tools; tools not built yet are hidden, not disabled.
- **Canvas:** the pages on a gray background, with the overlay layer and
  alignment guides.
- **Right panel:** properties for the current selection (font, size, color,
  alignment, stroke and fill).
- **Empty state:** a drop zone with an "Open PDF" button.
- **Keyboard:** V select, T add text, E edit text, H highlight,
  ⌘Z / ⇧⌘Z undo/redo, ⌘S download, Delete removes the selection, arrow keys
  nudge by 1 pt (Shift: 10 pt).

Mockups may be produced in Google Stitch and dropped into `docs/design/`. When
present, they guide the visuals. This section defines the structure and
behaviour.

## 6. Feature phases

Each phase ships to production before the next starts. Each has its own
implementation plan.

### Phase 1: Core
- Scaffolding: Vite/React/TS, Tailwind, ESLint/Prettier, Vitest, Playwright,
  CI on GitHub Actions (lint, typecheck, test, build), Vercel deploy, CSP
  headers, AGPL `LICENSE`, README.
- Engine worker with MuPDF.js: open (file picker and drag-drop), password
  prompt for encrypted files, render, page count and sizes.
- Viewer: virtualized pages, zoom (fit width, fit page, 50–400%), thumbnails,
  page navigation, text search with highlighted results.
- Op log plus undo/redo infrastructure (exercised by a trivial test op).
- Download (save via MuPDF, Blob download, original file name + `-edited.pdf`).
- `beforeunload` warning when there are uncommitted changes.
- **Done when:** a 100-page PDF opens and scrolls smoothly, search works, a
  downloaded file is byte-valid, and the privacy checks in §8 pass in CI.

### Phase 2: Markup and add text
- Real PDF annotations: highlight, underline and strikethrough on selected
  text; ink (pen); rectangle and ellipse; line and arrow; sticky note. All can
  be selected, moved, recolored and deleted.
- Add text (FreeText rendered into page content) with font, size, color,
  alignment, bold and italic.
- Alignment guides that snap to existing text runs and other added objects.
- Export option: keep annotations editable (default) or flatten them.

### Phase 3: Signatures, forms and images
- Signature dialog: draw (with smoothing), type (script fonts) or upload an
  image. Background removal for uploaded photos via a simple threshold. Place
  and resize. Kept in memory for reuse during the session only.
- Image insert (PNG/JPEG).
- AcroForm filling: text, checkbox, radio, dropdown, with tab order. Export
  option to flatten the form.

### Phase 4: Pages
- Reorder (drag thumbnails), rotate, delete, insert blank page, insert pages
  from another PDF (merge), extract selected pages to a new PDF, split.

### Phase 5: Edit existing text
- "Edit text" tool: hovering highlights text runs and clicking edits in place,
  following the §4 font policy.
- Style changes on existing runs (size, color).
- Golden tests against the invoice fixture and a set of real-world PDFs
  (Word-exported, LaTeX, Google Docs, scanned-plus-OCR).

### Phase 6: Document tools
- **Redact:** mark areas or search terms, then apply. Content underneath is
  truly removed (text, images, vector graphics) using MuPDF redaction. The app
  shows a confirmation and checkpoints beforehand.
- **Compress:** garbage collection, stream deflate, font subsetting, and image
  downsampling (re-encode images above a DPI threshold). Shows before and after
  sizes.
- **Password:** open protected files; set or remove a user/owner password
  (AES-256) and permissions on export.

### Phase 7: OCR
- Tesseract.js in its own worker, with language data self-hosted and English
  bundled by default. Adds an invisible text layer to scanned pages so they
  become searchable, selectable and editable via Phase 5.

### Phase 8: Word conversion
- **PDF → DOCX:** structured text, paragraphs and images, with basic tables
  where they can be detected. Fidelity is best-effort and the UI says so.
- **DOCX → PDF** is out of scope until there is a viable fully client-side
  renderer.

## 7. Error handling

- Corrupt or unsupported PDFs: MuPDF attempts repair. If that fails, the user
  sees a clear message. Nothing crashes, and the error report is shown locally
  only (never sent anywhere).
- Wrong password: inline error and retry.
- Worker crash: catch it, restart the worker, reopen from the last checkpoint
  plus the replayed op log, and show a toast. No edits are lost.
- An op fails to apply: it is rejected, the document stays at its prior state,
  and the user is told why (e.g. "This text uses a font that can't be
  re-encoded; pick a replacement font").
- Large files: warn above 200 MB. Rendering stays virtualized to keep memory
  bounded.

## 8. Privacy enforcement

These are checks, not just intentions:

- **CSP** (`vercel.json`): `default-src 'self'; connect-src 'self';
  img-src 'self' blob: data:; worker-src 'self' blob:;
  script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
  font-src 'self'; frame-ancestors 'none'`.
  *Amended in Phase 1:* also `form-action 'none'; base-uri 'none'`, which
  `default-src` does not cover.
- Also `Referrer-Policy: no-referrer` and a `Permissions-Policy` that disables
  everything unused.
- **Playwright privacy test (CI):** open a fixture, edit, download, and assert:
  - no requests to non-origin hosts;
  - no requests at all after the initial load;
  - `localStorage`, `sessionStorage`, IndexedDB and cookies are all empty;
  - no service worker is registered.
- **Lint rule:** forbid `localStorage`, `indexedDB`, `document.cookie`,
  `fetch` to absolute URLs, and `navigator.sendBeacon` in `src/`.

## 9. Testing

- **Engine unit tests (Vitest, Node):** each op applied to fixture PDFs.
  Assert on structured text, positions and fonts in the re-opened output.
- **Golden render tests:** render the edited pages to PNG and compare against
  checked-in baselines with a small pixel tolerance.
- **E2E (Playwright):** one happy path per phase, plus the privacy test.
- **Fixtures:** `tests/fixtures/` holds a recreated invoice that matches the
  screenshot layout, with no real personal data. Also a 100-page document, an
  AcroForm, an encrypted PDF, a scanned page, and a subset-font PDF.

## 10. Deployment

- GitHub repo (public). Every PR runs CI; `main` deploys to Vercel production
  and PRs get preview URLs.
- `LICENSE` (AGPL-3.0), and a README with privacy guarantees, a local dev
  guide and third-party font licenses.

## 11. Out of scope

- Backend services, accounts, cloud storage, sharing links, real-time
  collaboration.
- Paragraph reflow when editing existing text.
- DOCX → PDF, and other office formats.
- Digital certificate signatures (PKI / PAdES). "Sign" means a visual
  signature.
- Mobile-optimized full editing UI.
- PDF/A conversion and accessibility tagging. These may come later as their
  own spec.
