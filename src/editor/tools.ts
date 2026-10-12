import { create } from 'zustand';
import type { Color, TextSpec, TextStyle } from '../shared/types';

// Interaction state for the editing tools (spec §5). In-progress interactions live here and
// become ops only on commit (spec §3.3).

export type Tool =
  | 'select'
  | 'text'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'ink'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'note';

export type TextDraft = {
  id: string;
  page: number;
  spec: TextSpec;
  /** True for text that hasn't been committed yet (commit = text.add, else text.update). */
  isNew: boolean;
};

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
  shape: ShapeStyle;
  ink: ShapeStyle;
  setTool(tool: Tool): void;
  select(id: string | null): void;
  setDraft(draft: TextDraft | null): void;
  updateDraftSpec(patch: Partial<TextSpec>): void;
  setShapeStyle(patch: Partial<ShapeStyle>): void;
  setInkStyle(patch: Partial<ShapeStyle>): void;
};

export const useTools = create<ToolsState>()((set, get) => ({
  tool: 'select',
  selectedId: null,
  draft: null,
  shape: { color: [0.86, 0.15, 0.15], fill: null, width: 2, opacity: 1 },
  ink: { color: [0.15, 0.39, 0.92], fill: null, width: 2, opacity: 1 },

  setTool(tool) {
    set({ tool, selectedId: tool === 'select' ? get().selectedId : null });
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
  h: 'highlight',
};
