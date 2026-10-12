// Types shared by the engine worker and the UI thread. No runtime dependencies.
import type { FontFamily } from './fonts';

/** A rectangle in PDF points, MuPDF page space (origin top-left, y grows downward). */
export type Rect = { x: number; y: number; w: number; h: number };

export type PageInfo = { index: number; width: number; height: number };

export type SearchHit = { page: number; rects: Rect[] };

export type OpenResult =
  | { status: 'ok'; pages: PageInfo[]; repaired: boolean; hasForm: boolean }
  | { status: 'needs-password' }
  | { status: 'wrong-password' }
  | { status: 'error'; message: string };

/** RGB, each channel 0..1. */
export type Color = [r: number, g: number, b: number];

/** A point in PDF points, page space (origin top-left of the displayed page, y down). */
export type Point = { x: number; y: number };

/** Upper-left, upper-right, lower-left, lower-right (MuPDF quad order). */
export type Quad = [ul: Point, ur: Point, ll: Point, lr: Point];

export type MarkupKind = 'highlight' | 'underline' | 'strikeout';

export type AnnotSpec =
  | { type: MarkupKind; quads: Quad[]; color: Color; opacity: number }
  | { type: 'ink'; paths: Point[][]; color: Color; width: number; opacity: number }
  | {
      type: 'rect' | 'ellipse';
      rect: Rect;
      color: Color;
      fill: Color | null;
      width: number;
      opacity: number;
    }
  | { type: 'line' | 'arrow'; a: Point; b: Point; color: Color; width: number; opacity: number }
  | { type: 'note'; at: Point; text: string; color: Color };

export type AnnotType = AnnotSpec['type'];

export type TextAlign = 'left' | 'center' | 'right';

export type TextStyle = {
  /** Bundled family; for edited text, the fallback when the original font lacks a glyph. */
  family: FontFamily;
  /**
   * Edited existing text (spec §4): prefer the run's own font. `fontName` is the PDF's name for
   * it, shown in the UI. The engine falls back to `family` when that font can't draw a glyph.
   */
  original?: { fontName: string };
  size: number;
  color: Color;
  align: TextAlign;
  bold: boolean;
  italic: boolean;
};

/**
 * Text added to the page content. `box` is the layout box: lines are aligned within its
 * width, and the first baseline sits at `box.y + ascent`.
 */
export type TextSpec = { box: Rect; text: string; style: TextStyle };

/**
 * Images (and signatures) are registered with the engine once under a random key and
 * referenced from ops by that key, so the op log never carries image bytes.
 */
export type ImageAsset = { key: string; bytes: Uint8Array; width: number; height: number };

/** An existing line of text on a page, used for snapping and new-text defaults (spec §4). */
export type TextRun = {
  text: string;
  bbox: Rect;
  baseline: number;
  x0: number;
  x1: number;
  font: string;
  size: number;
  color: Color;
};

/**
 * Everything that changes the document is an Op (spec §3.3). Objects created by an op keep
 * their `id` for later update/delete ops.
 */
export type Op =
  | { kind: 'meta.setTitle'; title: string }
  | { kind: 'annot.add'; id: string; page: number; annot: AnnotSpec }
  | { kind: 'annot.update'; id: string; page: number; annot: AnnotSpec }
  | { kind: 'annot.delete'; id: string; page: number }
  | { kind: 'text.add'; id: string; page: number; spec: TextSpec }
  | { kind: 'text.update'; id: string; page: number; spec: TextSpec }
  | { kind: 'text.delete'; id: string; page: number }
  /**
   * Replaces an existing run of text in place (spec §6 Phase 5). `target` is the run as the
   * user saw it; `spec` is the replacement (its box keeps the run's baseline and anchored edge).
   */
  | {
      kind: 'text.edit';
      id: string;
      page: number;
      target: { text: string; bbox: Rect };
      spec: TextSpec;
    }
  | { kind: 'image.add'; id: string; page: number; box: Rect; image: string }
  | { kind: 'image.update'; id: string; page: number; box: Rect; image: string }
  | { kind: 'image.delete'; id: string; page: number }
  | { kind: 'form.set'; field: string; value: string | boolean }
  /** `order` lists the current page indices in their new order (a permutation). */
  | { kind: 'page.move'; order: number[] }
  /** Clockwise. */
  | { kind: 'page.rotate'; pages: number[]; by: 90 | 180 | 270 }
  | { kind: 'page.delete'; pages: number[] }
  | { kind: 'page.insertBlank'; at: number; width: number; height: number }
  /** Pages of a registered document (see EngineApi.registerDocument), inserted before `at`. */
  | { kind: 'page.insertFrom'; at: number; source: string; pages: number[] }
  /**
   * True redaction (spec §6 Phase 6): everything under the rects is removed for good (text,
   * image pixels, vector graphics, annotations, form-field values, replacement/alt text) and
   * black boxes drawn. All areas, across pages, are one op (one undo step).
   */
  | { kind: 'redact'; areas: { page: number; rects: Rect[] }[] };

/** What a password-protected PDF allows without the permissions (owner) password. */
export type Permissions = {
  print: boolean;
  copy: boolean;
  edit: boolean;
  annotate: boolean;
  forms: boolean;
};

export type FieldType = 'text' | 'checkbox' | 'radio' | 'choice' | 'signature' | 'button';

/** One form widget on a page (a field with several widgets appears once per widget). */
export type FormField = {
  name: string;
  type: FieldType;
  rect: Rect;
  value: string;
  readOnly: boolean;
  multiline: boolean;
  maxLen: number;
  /** For checkboxes and radio buttons: the value this widget sets when selected. */
  onState: string | null;
  /** Dropdown options: what's shown, and the export value stored in the PDF. */
  options: { label: string; value: string }[];
};

/** Ops that get a checkpoint taken before them (redact, page delete; spec §3.3). */
export const DESTRUCTIVE_KINDS: ReadonlySet<Op['kind']> = new Set<Op['kind']>([
  'page.delete',
  'redact',
]);
