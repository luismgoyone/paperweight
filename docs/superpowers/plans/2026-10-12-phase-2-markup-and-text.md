# Phase 2 (Markup and Add Text) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real PDF markup annotations and "add text" (rendered into page content in a bundled font), with selection/move/recolor/delete, alignment guides that snap to existing text, and a flatten-on-export option.

**Architecture:** New `Op` kinds (`annot.add|update|delete`, `text.add|update|delete`) carry a stable `id`. The engine applies annotation ops with MuPDF's annotation API (the annotation's `/NM` is the id) and text ops by appending one content stream per text object, wrapped in a marked-content sequence tagged with the id, using fonts the UI preloads and registers with the worker. The UI derives the current object list by folding the active ops (`editor/objects.ts`), so selection, hit-testing and snapping are pure and unit-tested. Interactions live in a per-page overlay and become ops only on commit (spec §3.3).

**Tech Stack:** as Phase 1. No new npm dependencies. Fonts are static assets (OFL-1.1) in `public/fonts/`.

**Spec:** `docs/superpowers/specs/2026-10-12-pdf-editor-design.md` (§3.3, §4, §5, §6 Phase 2, §8, §9)

## Global Constraints

- All Phase 1 constraints (no backend, nothing persisted, same-origin assets only, CSP, AGPL).
- Fonts are self-hosted and **fetched during the initial load** (right after the engine starts), so the §8 "no requests after load" check keeps holding. No lazy font fetches.
- Bundled fonts (spec §4): Liberation Sans/Serif/Mono, Inter, Noto Sans, Noto Serif, each Regular/Bold/Italic/BoldItalic. (Carlito/Caladea arrive with Phase 5 font matching; script fonts with Phase 3.)
- New text defaults to the font family, size and color of the nearest existing text run (spec §4), mapped to a bundled family: Helvetica/Arial→Liberation Sans, Times→Liberation Serif, Courier→Liberation Mono, otherwise Inter.
- Snapping: left edge, right edge and baseline of existing text runs and other added objects; snapped values are exact (success criterion 2: within 0.5 pt).
- Toolbar groups (spec §5): Select | Add text | Highlight, Underline, Strikethrough, Pen, Shapes (rect, ellipse), Line, Arrow, Note. Edit text, Sign, Form, Image, Redact stay hidden.
- Shortcuts: V select, T add text, H highlight, Delete removes selection, arrows nudge 1 pt (Shift 10 pt), Esc cancels.
- Export: "Keep annotations editable" (default) or "Flatten annotations".

## Review Focus

1. **Pages with /Rotate or a non-zero MediaBox origin** → objects land where the user clicked (Task 4/5 tests use a rotated + offset fixture page).
2. **Undo across an annot.add then annot.update then annot.delete** → each step restores exactly (Task 4 engine test).
3. **Text containing characters the font lacks (e.g. emoji, CJK)** → the op is rejected with a clear message, document unchanged (Task 5 test).
4. **Highlight drag that crosses lines / starts in whitespace** → quads cover exactly the selected text; empty selection creates nothing (Task 3/9 tests).
5. **Flattened export reopened** → no annotations remain and the page renders the same (Task 6 pixel test).

---

### Task 1: Self-hosted fonts and preloading
**Files:** `public/fonts/*.ttf`, `public/fonts/LICENSES.md`, `src/shared/fonts.ts`, `src/editor/fonts.ts`, `src/engine/fonts.ts`, `src/engine/api.ts` (+`registerFont`), `tests/unit/fonts.test.ts`, `tests/e2e/privacy.spec.ts`.
**Interfaces:**
```ts
// shared/fonts.ts
export type FontFamily = 'Liberation Sans' | 'Liberation Serif' | 'Liberation Mono' | 'Inter' | 'Noto Sans' | 'Noto Serif';
export type FontStyleKey = { bold: boolean; italic: boolean };
export const FONT_FAMILIES: FontFamily[];
export function fontFile(family: FontFamily, s: FontStyleKey): string;       // 'fonts/LiberationSans-Bold.ttf'
export function fontId(family: FontFamily, s: FontStyleKey): string;          // 'LiberationSans-Bold'
export function familyForPdfFont(pdfFontName: string): FontFamily;           // spec §4 table
// engine: registerFont(id, bytes) / getFont(id) -> mupdf.Font
// editor/fonts.ts: loadFonts(engine): Promise<void> (fetch all, FontFace.add, engine.registerFont)
```
- [ ] Test: every manifest entry exists on disk and opens with `new mupdf.Font(id, bytes)`, `encodeCharacter('A') > 0`; `familyForPdfFont` table (`ABCDEF+Arial-BoldMT`→Liberation Sans, `TimesNewRomanPSMT`→Liberation Serif, `CourierNewPSMT`→Liberation Mono, `Calibri`→Inter).
- [ ] Download fonts into a scratch dir, verify, copy to `public/fonts/` with license texts.
- [ ] Store gets `fontsReady`; privacy e2e waits for `[data-testid=fonts-ready]` before switching to the "after load" phase.
- [ ] Commit `feat: self-host bundled fonts and preload them at startup`.

### Task 2: Shared types for Phase 2 ops and a richer fixture
**Files:** `src/shared/types.ts`, `scripts/make-fixtures.mjs`, `tests/fixtures/invoice.pdf`, `tests/fixtures/rotated.pdf`.
```ts
export type Color = [r: number, g: number, b: number];               // 0..1
export type Point = { x: number; y: number };                         // PDF points, page space (top-left origin)
export type Quad = [Point, Point, Point, Point];                       // ul, ur, ll, lr
export type MarkupKind = 'highlight' | 'underline' | 'strikeout';
export type AnnotSpec =
  | { type: MarkupKind; quads: Quad[]; color: Color; opacity: number }
  | { type: 'ink'; paths: Point[][]; color: Color; width: number; opacity: number }
  | { type: 'rect' | 'ellipse'; rect: Rect; color: Color; fill: Color | null; width: number; opacity: number }
  | { type: 'line' | 'arrow'; a: Point; b: Point; color: Color; width: number; opacity: number }
  | { type: 'note'; at: Point; text: string; color: Color };
export type TextAlign = 'left' | 'center' | 'right';
export type TextStyle = { family: FontFamily; size: number; color: Color; align: TextAlign; bold: boolean; italic: boolean };
export type TextSpec = { box: Rect; text: string; style: TextStyle };   // box.y = top; first baseline = top + ascent
export type Op =
  | { kind: 'meta.setTitle'; title: string }
  | { kind: 'annot.add'; id: string; page: number; annot: AnnotSpec }
  | { kind: 'annot.update'; id: string; page: number; annot: AnnotSpec }
  | { kind: 'annot.delete'; id: string; page: number }
  | { kind: 'text.add'; id: string; page: number; spec: TextSpec }
  | { kind: 'text.update'; id: string; page: number; spec: TextSpec }
  | { kind: 'text.delete'; id: string; page: number };
export type TextRun = { page: number; text: string; bbox: Rect; baseline: number; x0: number; x1: number; font: string; size: number; color: Color };
```
- [ ] Fixtures: `invoice.pdf` (Helvetica, a header, a line-item table with right-aligned amounts incl. `$26`, no personal data); `rotated.pdf` (one page `/Rotate 90`, one with MediaBox origin `[50 50 662 842]`).
- [ ] Commit `test: Phase 2 op types and invoice/rotated fixtures`.

### Task 3: Engine text runs and text selection
**Files:** `src/engine/text.ts`, `tests/unit/engine-text.test.ts`; `EngineApi.textRuns(page)`, `EngineApi.selectText(page, a: Point, b: Point): Quad[]`.
- [ ] Tests: invoice runs include `$26` with font matching /Helvetica/, size 10, baseline ≈ the fixture's y; right-aligned amounts share `x1` within 0.01; `selectText` across two lines returns quads on both lines; a drag in empty space returns `[]`; rotated page coordinates are in unrotated page space consistently with rendering.
- [ ] Commit `feat(engine): text runs and selection quads`.

### Task 4: Annotation ops
**Files:** `src/engine/ops/annotations.ts`, `src/engine/ops/index.ts`, `tests/unit/engine-annotations.test.ts`.
- `annot.add`: `page.createAnnotation(type)` (highlight→Highlight, underline→Underline, strikeout→StrikeOut, ink→Ink, rect→Square, ellipse→Circle, line/arrow→Line with `setLineEndingStyles('None', 'OpenArrow')` for arrow, note→Text), `setName(id)`, geometry, `setColor`, `setInteriorColor`, `setBorderWidth`, `setOpacity`, `update()`.
- `annot.update`: find by `getName() === id`, delete, re-add with the same id (keeps it simple and exact).
- `annot.delete`: find and `deleteAnnotation`. Unknown id → `OpError`.
- `pagesTouched` returns the op's page.
- [ ] Tests: each type round-trips through `save()`/reopen with type, name, color and rect; update moves the rect; delete removes; undo chain add→update→delete via `setOps` restores each state; rotated page annotation rect matches the requested page-space rect.
- [ ] Commit `feat(engine): markup, ink, shape, line and note annotations`.

### Task 5: Add-text ops (rendered into page content)
**Files:** `src/engine/ops/text-add.ts`, `src/engine/fonts.ts`, `tests/unit/engine-text-add.test.ts`.
- Layout: split on `\n`; per line measure `Σ advanceGlyph(gid) * size`; x by alignment inside `box`; first baseline `box.y + ascent*size` (ascent from font bbox ≈ 0.8 em when unavailable), line height `1.2 * size`.
- Write: add font once per document via `doc.addFont(font)` (Type0/Identity-H), put it in the page `/Resources/Font` as `/PE<fontId>`; content `/OC`-free marked content: `/PdfEditor <</Id (<id>)>> BDC q r g b rg BT /PE<id> size Tf x y Td <hex gids> Tj ET Q EMC` with y flipped to PDF space using the page's MediaBox and rotation transform (use `page.getTransform()` inverse).
- Each text object is its own stream appended to `/Contents` (converted to an array if needed). `text.update` replaces that stream; `text.delete` removes it.
- Characters with no glyph (`encodeCharacter` returns 0) → `OpError("<family> can't display "…"")`.
- [ ] Tests: added text is found by structured text at the expected x/baseline (±0.25 pt), size and RGB color; right-aligned text's right edge equals `box.x + box.w` within 0.5 pt; update moves it; delete removes it; emoji rejected and document unchanged; works on rotated and offset pages; reopen after save keeps it.
- [ ] Commit `feat(engine): add text in bundled fonts, rendered into page content`.

### Task 6: Export options (flatten)
**Files:** `src/engine/document.ts` (`save(options?: { flatten?: boolean })`), `src/engine/api.ts`, tests.
- Flatten works on a copy: reopen the saved bytes, `bake(true, false)`, save. The live document is untouched.
- [ ] Tests: flattened output has zero annotations; rendering page 1 of edited vs flattened differs by < 1% of pixels; non-flattened keeps annotations.
- [ ] Commit `feat(engine): flatten-annotations export option`.

### Task 7: Editor object model and snapping (pure)
**Files:** `src/editor/objects.ts`, `src/editor/snapping.ts`, `src/editor/ids.ts`, tests.
```ts
export type EditorObject = { id: string; page: number; kind: 'annot'; annot: AnnotSpec } | { id: string; page: number; kind: 'text'; spec: TextSpec };
export function foldObjects(ops: readonly Op[]): Map<string, EditorObject>;
export function objectBounds(o: EditorObject): Rect;
export function hitTest(objects: EditorObject[], page: number, p: Point, tolerance: number): EditorObject | undefined; // topmost
export function translate(o: EditorObject, dx: number, dy: number): EditorObject;
export type SnapTarget = { x0: number; x1: number; baseline: number };
export type Guide = { axis: 'x' | 'y'; at: number; from: number; to: number };
export function snapBox(box: Rect, baselineOffset: number, targets: SnapTarget[], threshold: number): { box: Rect; guides: Guide[] };
export function newId(): string; // crypto.randomUUID()
```
- [ ] Tests: fold add/update/delete; bounds per type (ink = path bbox + width/2); hit-test picks topmost and respects tolerance; snap left/right/baseline when within threshold gives exact equality; no snap beyond threshold; x and y snap independently; guide extents span both boxes.
- [ ] Commit `feat(editor): object model, hit testing and snapping`.

### Task 8: Stitch mockup for the editing UI
- [ ] Generate a Stitch screen (toolbar groups, selected text box with handles and alignment guide, properties panel with font/size/color/alignment/bold/italic and stroke/fill) into `docs/design/editing.*`. Commit `docs: editing UI mockup`.

### Task 9: Toolbar, overlay interactions and properties panel
**Files:** `src/ui/Toolbar.tsx`, `src/ui/Canvas/Overlay.tsx`, `src/ui/Canvas/TextEditor.tsx`, `src/ui/PropertiesPanel.tsx`, `src/editor/store.ts` (tool, selection, defaults, page text-run cache), `src/ui/useKeyboard.ts`, `src/ui/colors.ts`.
- Overlay (one per mounted page, absolutely positioned SVG + DOM): renders selection box/handles, guides, in-progress shapes/ink, notes as icons; converts pointer events to page points (`/ zoom`).
- Tools: highlight/underline/strike → drag selects text via `selectText` (debounced preview), commit on pointer-up if quads non-empty; pen → collect points, simplify (drop points < 0.75 pt apart), commit on up; rect/ellipse/line/arrow → drag, Shift constrains; note → click places, opens a small textarea; add text → click/drag creates a box with a live `TextEditor` (contenteditable-free `<textarea>` styled with the bundled FontFace at zoom), defaults from the nearest run, commits on blur/⌘Enter, Esc cancels; empty text commits nothing.
- Select tool: click hit-tests objects; drag moves with snapping (guides shown); Delete removes; arrows nudge; double-click a text object re-opens the editor.
- Properties panel: for text (family, size, color, align, bold, italic) and annots (color, width, fill, opacity); changes commit `*.update` ops.
- [ ] e2e `tests/e2e/markup.spec.ts`: highlight a word → download → reopened file has a Highlight annotation over that word; draw a rectangle, recolor it, move it, delete it, undo brings it back; pen stroke creates Ink; note with text.
- [ ] e2e `tests/e2e/add-text.spec.ts`: on invoice.pdf, add text near the amounts column, drag it so its right edge snaps to `$26`'s right edge (guide visible); download; reopened text run's `x1` equals `$26`'s within 0.5 pt, font maps to Liberation Sans, size equals the column's size.
- [ ] Commit per sub-feature.

### Task 10: Export dialog, docs, privacy, ship
- [ ] Download button opens a small menu: "Download PDF" (editable annotations) and "Download flattened". e2e: flattened download has no annotations.
- [ ] Privacy e2e extended: performs markup + add text before downloading; still zero requests after load.
- [ ] README: features, shortcuts, font licenses table; roadmap ticks Phase 2.
- [ ] Full suite on 3 browsers; PR; CI green; merge (user); verify production.
