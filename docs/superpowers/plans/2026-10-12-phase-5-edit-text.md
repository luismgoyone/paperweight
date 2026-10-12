# Phase 5 (Edit Existing Text) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click any line of existing text and change it in place, in the same font, size, color and baseline (spec §4, success criterion 1), with visible notice whenever a font has to be substituted.

**Architecture:** A `text.edit` op names an existing run (page, its text and bounding box at the time) and the replacement. The engine finds the run's characters with structured text, removes exactly those glyphs with a text-only MuPDF redaction (no black box, images and vector graphics untouched), and draws the replacement as an id-tagged marked-content section, exactly like added text. Font policy (§4): if the run's own font has every needed glyph, the replacement uses that font program (re-embedded as Type0/Identity-H, so it renders identically); otherwise the metric-compatible bundled family; otherwise the user's pick. The op result reports which case applied so the properties panel can show "Substituted: Arial → Liberation Sans". After the edit the run is an editable object like added text (later edits are `text.update`).

Probes (2026-10-12) established: `applyRedactions(false, 0, 0, 0)` removes only glyphs under the redaction rect (a `$26` in another column survives); it rewrites the page into a single content stream, **drops comments** and re-serializes operators without spaces (`/PdfEditor<</Id(x)>>BDC`), but keeps marked-content sections. So the content machinery must locate objects by marked section inside any stream (whitespace-insensitive), not by whole stream.

**Spec:** §4 (font policy), §6 Phase 5, §9 (golden tests), success criterion 1.

## Op

```ts
| { kind: 'text.edit'; id: string; page: number;
    target: { text: string; bbox: Rect };          // the run as the user saw it
    text: string;                                  // replacement (single line)
    anchor: 'left' | 'right';                      // keep this edge fixed (right for column-aligned numbers)
    style?: Partial<Pick<TextStyle, 'family' | 'size' | 'color' | 'bold' | 'italic'>> } // overrides
```

## Tasks
1. content.ts: marked-section addressing (find by regex, splice to matching EMC, rewrite stream in place); tests that text.add/update/delete and images survive a redaction on the same page.
2. Engine `editText`: locate run (exact text + bbox overlap ≥ 80%; reject if not found or not horizontal), redact glyph quads (inset 0.3 pt vertically), choose font per §4, draw at the first glyph's origin with the run's size/color (anchor right keeps x1), return `{ substitutedFrom?, substitutedTo? }`. Font program reuse via `doc.addFont(stextFont)`.
3. Fixtures: invoice (base-14 Helvetica), an embedded TrueType subset font PDF (generated with MuPDF from Liberation Sans subset to a few glyphs), a Type3/odd font case to exercise rejection.
4. Golden tests: edit `$26 → $31` on the invoice; compare rendered page to a checked-in baseline PNG (pixel tolerance) and assert structured text: same font family, size, color, baseline ±0.1 pt, right edge ±0.5 pt; subset font missing a glyph → substitution reported and used.
5. Object model: `text.edit` creates a text object (subsequent edits are text.update of the same id; style.family 'embedded' is shown as the original font name).
6. UI: "Edit text" tool (E): hovering highlights runs (from cached text runs), click opens the inline editor prefilled with the run text in the run's style (embedded font rendered via a FontFace made from the font program? → use the bundled substitute for the on-canvas editor only, and the real font in the PDF), Enter/blur commits, Esc cancels. Properties panel: size and color changes; substitution notice.
7. e2e: invoice `$26 → $31`, download, verify criterion 1; privacy test extended; README; review; PR.
