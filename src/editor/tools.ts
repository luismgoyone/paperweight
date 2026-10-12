import { create } from 'zustand';
import type { Color, ImageAsset, Rect, TextSpec, TextStyle } from '../shared/types';

// Interaction state for the editing tools (spec §5). In-progress interactions live here and
// become ops only on commit (spec §3.3).

export type Tool =
  | 'select'
  | 'text'
  | 'edit'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'ink'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'note'
  | 'sign'
  | 'image'
  | 'form'
  | 'redact';

export type TextDraft = {
  id: string;
  page: number;
  spec: TextSpec;
  /** True for text that hasn't been committed yet (commit = text.add, else text.update). */
  isNew: boolean;
  /** For existing text: the committed spec, so cancel and no-op closes change nothing. */
  original: TextSpec | null;
  /** Set when editing a run of the PDF's own text (commit = text.edit). */
  edit?: { target: { text: string; bbox: Rect } };
  /** One line only, so Enter commits (a box on a flat form). */
  singleLine?: boolean;
};

/** Arrow-key nudges accumulate here and become one op when the key is released. */
export type Nudge = { id: string; dx: number; dy: number };

export type ShapeStyle = { color: Color; fill: Color | null; width: number; opacity: number };

export const DEFAULT_TEXT_STYLE: TextStyle = {
  family: 'Inter',
  size: 12,
  color: [0, 0, 0],
  align: 'left',
  bold: false,
  italic: false,
};

export const MARKUP_COLORS: Record<'highlight' | 'underline' | 'strikeout', Color> = {
  highlight: [1, 0.85, 0.2],
  underline: [0.15, 0.39, 0.92],
  strikeout: [0.86, 0.15, 0.15],
};

export const PALETTE: { name: string; color: Color }[] = [
  { name: 'Black', color: [0, 0, 0] },
  { name: 'Gray', color: [0.42, 0.45, 0.5] },
  { name: 'Red', color: [0.86, 0.15, 0.15] },
  { name: 'Orange', color: [0.92, 0.45, 0.05] },
  { name: 'Yellow', color: [1, 0.85, 0.2] },
  { name: 'Green', color: [0.09, 0.64, 0.29] },
  { name: 'Blue', color: [0.15, 0.39, 0.92] },
  { name: 'Purple', color: [0.58, 0.2, 0.92] },
];

type ToolsState = {
  tool: Tool;
  selectedId: string | null;
  draft: TextDraft | null;
  nudge: Nudge | null;
  /** Signatures made this session (memory only; forgotten with the tab, spec §2). */
  signatures: ImageAsset[];
  /** An image or signature waiting to be placed with the next click on a page. */
  pending: { asset: ImageAsset; kind: 'signature' | 'image' } | null;
  signatureDialogOpen: boolean;
  /** Areas marked for redaction, not yet applied (spec §6 Phase 6). */
  redactMarks: { page: number; rect: Rect }[];
  shape: ShapeStyle;
  ink: ShapeStyle;
  setTool(tool: Tool): void;
  select(id: string | null): void;
  setDraft(draft: TextDraft | null): void;
  updateDraftSpec(patch: Partial<TextSpec>): void;
  updateDraftStyle(patch: Partial<TextStyle>): void;
  addNudge(id: string, dx: number, dy: number): void;
  takeNudge(): Nudge | null;
  setShapeStyle(patch: Partial<ShapeStyle>): void;
  addSignature(asset: ImageAsset): void;
  setPending(pending: ToolsState['pending']): void;
  setSignatureDialogOpen(open: boolean): void;
  addRedactMarks(marks: { page: number; rect: Rect }[]): void;
  clearRedactMarks(): void;
  setInkStyle(patch: Partial<ShapeStyle>): void;
};

export const useTools = create<ToolsState>()((set, get) => ({
  tool: 'select',
  selectedId: null,
  draft: null,
  nudge: null,
  signatures: [],
  pending: null,
  signatureDialogOpen: false,
  redactMarks: [],
  shape: { color: [0.86, 0.15, 0.15], fill: null, width: 2, opacity: 1 },
  ink: { color: [0.15, 0.39, 0.92], fill: null, width: 2, opacity: 1 },

  setTool(tool) {
    set({
      tool,
      selectedId: tool === 'select' ? get().selectedId : null,
      pending: tool === 'sign' || tool === 'image' ? get().pending : null,
    });
  },
  addSignature(asset) {
    set({ signatures: [...get().signatures, asset] });
  },
  setPending(pending) {
    set({ pending });
  },
  setSignatureDialogOpen(signatureDialogOpen) {
    set({ signatureDialogOpen });
  },
  addRedactMarks(marks) {
    set({ redactMarks: [...get().redactMarks, ...marks] });
  },
  clearRedactMarks() {
    set({ redactMarks: [] });
  },
  select(selectedId) {
    set({ selectedId });
  },
  setDraft(draft) {
    set({ draft });
  },
  updateDraftSpec(patch) {
    const draft = get().draft;
    if (draft) set({ draft: { ...draft, spec: { ...draft.spec, ...patch } } });
  },
  updateDraftStyle(patch) {
    const draft = get().draft;
    if (draft)
      set({
        draft: { ...draft, spec: { ...draft.spec, style: { ...draft.spec.style, ...patch } } },
      });
  },
  addNudge(id, dx, dy) {
    const n = get().nudge;
    set({ nudge: n && n.id === id ? { id, dx: n.dx + dx, dy: n.dy + dy } : { id, dx, dy } });
  },
  takeNudge() {
    const n = get().nudge;
    set({ nudge: null });
    return n;
  },
  setShapeStyle(patch) {
    set({ shape: { ...get().shape, ...patch } });
  },
  setInkStyle(patch) {
    set({ ink: { ...get().ink, ...patch } });
  },
}));

export const TOOL_SHORTCUTS: Partial<Record<string, Tool>> = {
  v: 'select',
  t: 'text',
  e: 'edit',
  h: 'highlight',
};
