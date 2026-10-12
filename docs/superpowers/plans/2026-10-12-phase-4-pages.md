# Phase 4 (Pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder (drag thumbnails), rotate, delete, insert blank pages, insert pages from another PDF (merge), extract selected pages to a new PDF, and split.

**Architecture:** Page changes are ops (`page.move|rotate|delete|insertBlank|insertFrom`) applied by the engine with MuPDF's page-tree API (`rearrangePages`, `/Rotate`, `deletePage`, `addPage`+`insertPage`, `graftPage`). Ops carry page indices valid at the moment they're applied, so replay stays exact. The UI's object model folds page ops too, remapping (or dropping) added objects so later edits reference the right page. Merged PDFs are registered with the engine once by key, like images, so the op log never carries document bytes. Extract and split are exports: the engine builds new documents from the current state (`graftPage` into a fresh `PDFDocument`) and the UI downloads them; they don't change the open document.

**Spec:** §3.3 (page.* ops; checkpoint before page delete), §5 (sidebar: drag-to-reorder, add, rotate, delete), §6 Phase 4.

## Global Constraints
- All earlier constraints. `page.delete` is destructive: checkpoint first (`DESTRUCTIVE_KINDS`).
- A document always keeps at least one page (deleting the last page is rejected).
- Inserted PDFs that are encrypted ask for their password (same dialog); bytes stay in memory only.
- Split downloads one file per range, named `<name>-pages-<a>-<b>.pdf`.

## Review Focus
1. Undo after move + delete + insert interleaved with annotations/text on the affected pages → exact restore, objects back on their pages.
2. Rotating a page with added text/images → they rotate with the page (they're page content) and the overlay maps pointer input through the new rotation.
3. Inserting a PDF whose fonts/resources clash by name with ours (`PE-…`) → no collision (graft copies objects).
4. Selecting many thumbnails (Shift/⌘ click) then delete/extract.
5. Search hits, current page and thumbnails after reordering point at the right pages.

## Op shapes

```ts
| { kind: 'page.move'; order: number[] }                       // new order as old indices (a permutation)
| { kind: 'page.rotate'; pages: number[]; by: 90 | 180 | 270 } // clockwise
| { kind: 'page.delete'; pages: number[] }                     // destructive: checkpoint first
| { kind: 'page.insertBlank'; at: number; width: number; height: number }
| { kind: 'page.insertFrom'; at: number; source: string; pages: number[] }
```

Object model: page ops remap object pages (`move`, `insert*` shift indices; `delete` drops objects on
deleted pages). Objects on a rotated page leave the *editable* object list: they stay in the PDF and
rotate with the page, but text boxes have no rotation in the model. This is documented in the UI
(a note in the properties panel) and README.

## Tasks
1. Engine page ops + tests (fixture: simple.pdf, 100-pages.pdf, rotated.pdf, invoice.pdf with annotations).
2. Doc assets: `registerDocument(key, bytes, password?)` → page count; `page.insertFrom { at, source: key, pages: number[] }`.
3. Exports: `extractPages(pages): Uint8Array`, split ranges; tests reopen outputs.
4. Object model: fold page ops (remap/drop), tests.
5. Sidebar UI: multi-select thumbnails, drag-to-reorder (pointer events; keyboard: Alt+↑/↓ moves), rotate ↺/↻, delete, insert blank after, insert from file, extract selected, split dialog (every N pages / custom ranges). Stitch mockup first.
6. e2e (reorder by drag, rotate, delete+undo, merge, extract, split), privacy test extended, README, review, PR.
