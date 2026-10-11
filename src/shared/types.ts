// Types shared by the engine worker and the UI thread. No runtime dependencies.
import type { FontFamily } from './fonts';

/** A rectangle in PDF points, MuPDF page space (origin top-left, y grows downward). */
export type Rect = { x: number; y: number; w: number; h: number };

export type PageInfo = { index: number; width: number; height: number };

export type SearchHit = { page: number; rects: Rect[] };

export type OpenResult =
  | { status: 'ok'; pages: PageInfo[]; repaired: boolean }
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
  family: FontFamily;
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
  | { kind: 'text.delete'; id: string; page: number };

/** Ops that get a checkpoint taken before them (redact, page delete; spec §3.3). */
export const DESTRUCTIVE_KINDS: ReadonlySet<Op['kind']> = new Set<Op['kind']>([]);
