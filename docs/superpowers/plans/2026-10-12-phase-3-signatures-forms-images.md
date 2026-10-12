# Phase 3 (Signatures, Forms and Images) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visual signatures (draw, type, upload with background removal), PNG/JPEG image insertion, and AcroForm filling (text, checkbox, radio, dropdown) with a flatten-form export option.

**Architecture:** Images and signatures are one op family, `image.add|update|delete` (spec §3.3: "`image.add` … signatures too"), drawn into page content exactly like Phase 2 text: one id-tagged content stream per object that paints an image XObject, so move/resize is an `image.update`. Signature creation (draw smoothing, typed rendering, threshold background removal) is pure UI-side bitmap work producing PNG bytes; signatures are kept in memory for the session only. Forms: the engine lists widgets per page; `form.set { field, value }` ops set values by fully-qualified field name; the UI overlays native inputs on widget rects with the document's tab order. Export gains "flatten form" (bake widgets).

**Tech Stack:** as before. No new npm dependencies. Script fonts Dancing Script and Great Vibes (OFL, named in spec §4) self-hosted and preloaded with the others.

**Spec:** `docs/superpowers/specs/2026-10-12-pdf-editor-design.md` (§2, §3.3, §4, §6 Phase 3, §8)

## Global Constraints

- All earlier constraints. Signatures and uploaded images live in memory only; nothing persisted (spec §2).
- Image op payload is PNG or JPEG bytes; the engine never fetches anything.
- Phones (spec §2): viewing, signing and form filling must work with touch; pointer events + `touch-action: none` on drawing surfaces.
- Tools: Sign, Form fill, Image join the toolbar group "Sign, Form fill, Image" (spec §5).

## Review Focus

1. **Huge photos as signatures/images** (12 MP JPEG) → downscaled to ≤ 2000 px on the long edge before entering the op log; memory bounded.
2. **Radio groups** → setting one widget's state turns the others off; reopened file shows one selected.
3. **Field names with dots / duplicate widgets for one field** → `form.set` sets every widget of the field.
4. **Read-only fields** → not editable in the overlay; op rejected by the engine.
5. **Flattened form + annotations editable** → bake only widgets; annotations stay.

---

### Task 1: Image ops in the engine
`src/engine/ops/images.ts`; `Op` += `image.add { id, page, box: Rect, data: Uint8Array, mime: 'image/png'|'image/jpeg' }`, `image.update { id, page, box }`, `image.delete`. Reuse Phase 2's content-stream helpers (extract `contentsArray`, `ensureWrapped`, `findStream`, `pageResources` into `src/engine/ops/content.ts`). Image XObject via `doc.addImage(new mupdf.Image(bytes))`, resource `/PEImg-<id>`; draw `q <inv ctm> cm w 0 0 -h x y+h cm /PEImg-<id> Do Q` in page space. Update keeps the XObject and rewrites the stream. Tests: placed image bbox (via `toStructuredText` image blocks) equals box on normal/rotated/offset pages; update moves/resizes; delete removes; PNG alpha preserved (render pixel under transparent area stays white); JPEG works; checkpoint replay with images; op log memory: `data` stored once (history holds references, not copies).

### Task 2: Signature bitmap helpers (pure, unit-tested in Node)
`src/editor/signature.ts`: `smoothStroke(points): Point[]` (Chaikin, 2 iterations), `strokesToSvgPath`, `removeBackground(rgba, threshold): Uint8ClampedArray` (luminance > threshold → alpha 0, with 1-step soft edge), `trimTransparent(rgba, w, h): Rect`, `fitWithin(w, h, max)`. Tests for each with synthetic arrays.

### Task 3: Script fonts
Download Dancing Script and Great Vibes (OFL) into `public/fonts/`, add to the font manifest as non-PDF families used only for typed-signature rendering (canvas), preload with the others. Test files load.

### Task 4: Signature dialog and placement
`src/ui/dialogs/SignatureDialog.tsx`: tabs Draw (canvas, pointer events, smoothing, Clear), Type (name input, pick one of 2 script fonts, preview), Upload (file → canvas, threshold slider with live preview, auto-trim). Produces PNG bytes + natural size; added to an in-memory "session signatures" list (tools store) for reuse. Placing: the Sign tool shows the session signatures; clicking a page places it (default width 150 pt, keep aspect) as `image.add`. Selection/move/resize (corner handles, aspect locked with Shift-free default) via `image.update`. e2e: draw a signature, place it, download → page has an image where placed; typed signature renders; upload with threshold produces transparency.

### Task 5: Image tool
Toolbar "Image": file picker (PNG/JPEG), downscale >2000 px, place at click, resize/move/delete like signatures. e2e.

### Task 6: AcroForm engine
`src/engine/forms.ts`: `listFields(page)` → `{ name, type: 'text'|'checkbox'|'radio'|'choice'|'signature'|'button', rect, value, options, readOnly, multiline, maxLen, onState }` from `PDFPage.getWidgets()`; `Op` += `form.set { field, value: string | boolean }` applying to all widgets of the field (`setTextValue`, `toggle` to reach the desired state, `setChoiceValue`), then `update()`. Fixture `form.pdf` generated in `make-fixtures.mjs` (hand-built AcroForm: text, multiline text, checkbox, radio group of 3, dropdown, read-only text). Tests: list; set each type and reopen; radio exclusivity; read-only rejected; save `flattenForms` bakes widgets only.

### Task 7: Form-fill UI
Form fill tool (also auto-offered when a document has fields: a banner "This PDF has fillable fields"). Overlay renders native inputs over widget rects (scaled by zoom), tab order = document widget order, commit `form.set` on change/blur (checkbox/radio immediately). Phone-friendly hit targets. Download menu gets "Flatten form fields". e2e: fill all field types, tab through, download, reopen values; flattened has no widgets.

### Task 8: Stitch mockups, README, privacy, ship
Stitch screens for the signature dialog and form fill. Privacy e2e extended with signing + form fill. README features/shortcuts/licenses. Full suite on 3 browsers, review agent, fixes, PR, merge (user), verify production.
