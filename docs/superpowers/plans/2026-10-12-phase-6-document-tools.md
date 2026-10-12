# Phase 6 (Document Tools: Redact, Compress, Password) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** True redaction (marked areas and search terms; content underneath really removed), compression with before/after sizes, and setting or removing passwords and permissions on export.

**Architecture:**
- **Redact** is an op, `{ kind: 'redact'; page; rects: Rect[] }`, destructive (checkpoint first, spec §3.3). The engine creates Redact annotations for the rects and applies them with MuPDF's redaction: text removed, images under the area have their pixels removed (`REDACT_IMAGE_PIXELS`), vector graphics touched by the area removed (`REDACT_LINE_ART_REMOVE_IF_TOUCHED`), black boxes drawn. Added objects (sections) on the page keep working (Phase 5 made addressing section-based). Marking happens in the UI (a Redact tool for areas; "Redact all matches" from search); applying shows a confirmation that this can't be undone after download.
- **Compress** is an export on a copy: `garbage=4` (dedupe), deflate streams, `subsetFonts()`, and image downsampling: each image XObject whose effective resolution on the page exceeds the threshold (default 150 dpi) is resampled to the threshold and re-encoded as JPEG (quality 75; images with soft masks keep their mask and are only resampled when safe), keeping a replacement only if it's smaller. The dialog shows the current and compressed sizes before downloading.
- **Password** is an export option: set a user (open) password and/or owner password with AES-256 and permissions (print, copy, edit, annotate, forms); or remove the password from a protected file (save decrypted). Passwords never leave the worker; nothing is stored.

**Spec:** §3.3, §6 Phase 6, §7, §8.

## Probes (2026-10-12)
- `imageRef.writeRawStream(jpeg)` + `Width/Height/Filter=DCTDecode` replaces an image in place; page renders.
- `saveToBuffer('encrypt=aes-256,user-password=…,owner-password=…,permissions=4')` → opening needs the user password; `hasPermission('print')` true, `'edit'` false.
- Option strings can't escape `,` or `=` in passwords: such passwords are rejected with a clear message.

## Tasks
1. Engine `redact` op + tests (text under the rect gone from structured text; image pixels under it removed; text outside untouched; added text elsewhere on the page still updatable; undo restores via checkpoint).
2. Search-term redaction helper (hits → rects per page) + tests.
3. Compress export + tests (fixture with a 3000×2000 photo-like image; output smaller; renders; fonts subset; never larger than the input).
4. Password export (set/remove, permissions) + tests (reopen, needsPassword, permissions).
5. UI: Redact tool (drag areas; marked areas shown as red outlines until applied), "Apply redactions" with confirmation dialog, "Redact all matches" in search; Document menu with Compress (dialog with sizes) and Password (dialog). Stitch mockup first.
6. e2e for each, privacy test extended, README, review, PR.
