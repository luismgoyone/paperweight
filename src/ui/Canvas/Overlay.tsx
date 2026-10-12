import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { newId } from '../../editor/ids';
import { hitTest, objectBounds, translate, type EditorObject } from '../../editor/objects';
import { snapBox, type Guide, type SnapTarget } from '../../editor/snapping';
import { useEditor } from '../../editor/store';
import { nearestRun, styleFromRun } from '../../editor/text-defaults';
import { DEFAULT_TEXT_STYLE, MARKUP_COLORS, useTools, type Tool } from '../../editor/tools';
import { firstBaselineOffset } from '../../shared/fonts';
import type { AnnotSpec, PageInfo, Point, Quad, Rect, TextRun, TextSpec } from '../../shared/types';
import { cssColor } from '../colors';
import { measureTextWidth } from '../measure';
import { TextEditor } from './TextEditor';

const SNAP_PX = 6; // snap threshold in screen pixels
const HIT_PX = 4;

type Gesture =
  | { kind: 'move'; object: EditorObject; start: Point; moved: boolean }
  | { kind: 'markup'; tool: 'highlight' | 'underline' | 'strikeout'; start: Point }
  | { kind: 'ink'; points: Point[] }
  | { kind: 'shape'; tool: 'rect' | 'ellipse' | 'line' | 'arrow'; start: Point; end: Point };

export function annotOpFor(object: EditorObject, kind: 'update' | 'delete') {
  const base = { id: object.id, page: object.page };
  if (kind === 'delete') {
    return object.kind === 'annot'
      ? ({ kind: 'annot.delete', ...base } as const)
      : ({ kind: 'text.delete', ...base } as const);
  }
  return object.kind === 'annot'
    ? ({ kind: 'annot.update', ...base, annot: object.annot } as const)
    : ({ kind: 'text.update', ...base, spec: object.spec } as const);
}

/** Snap targets: existing text runs plus other added objects (spec §6 Phase 2). */
function snapTargets(
  runs: TextRun[],
  objects: EditorObject[],
  page: number,
  exclude?: EditorObject,
): SnapTarget[] {
  const excludeBounds = exclude ? objectBounds(exclude) : null;
  const targets: SnapTarget[] = runs
    // The object being moved shows up in the page's own text runs; don't snap to itself.
    .filter(
      (r) =>
        !excludeBounds ||
        !(
          r.bbox.x >= excludeBounds.x - 1 &&
          r.bbox.x + r.bbox.w <= excludeBounds.x + excludeBounds.w + 1 &&
          r.bbox.y >= excludeBounds.y - 2 &&
          r.bbox.y + r.bbox.h <= excludeBounds.y + excludeBounds.h + 2
        ),
    )
    .map((r) => ({ x0: r.x0, x1: r.x1, baseline: r.baseline }));
  for (const o of objects) {
    if (o.page !== page || o.id === exclude?.id) continue;
    const b = objectBounds(o);
    const baseline =
      o.kind === 'text'
        ? o.spec.box.y + firstBaselineOffset(o.spec.style.family, o.spec.style.size)
        : b.y + b.h;
    targets.push({ x0: b.x, x1: b.x + b.w, baseline });
  }
  return targets;
}

function normalize(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function constrain(tool: 'rect' | 'ellipse' | 'line' | 'arrow', a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (tool === 'rect' || tool === 'ellipse') {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: a.x + Math.sign(dx || 1) * size, y: a.y + Math.sign(dy || 1) * size };
  }
  // Lines snap to 45° steps.
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(dx, dy);
  return { x: a.x + Math.cos(angle) * length, y: a.y + Math.sin(angle) * length };
}

function quadPath(q: Quad, zoom: number): string {
  const [ul, ur, ll, lr] = q;
  return `M${ul.x * zoom},${ul.y * zoom}L${ur.x * zoom},${ur.y * zoom}L${lr.x * zoom},${lr.y * zoom}L${ll.x * zoom},${ll.y * zoom}Z`;
}

function ShapePreview({ annot, zoom }: { annot: AnnotSpec; zoom: number }) {
  const stroke = cssColor(annot.color);
  switch (annot.type) {
    case 'rect':
    case 'ellipse': {
      const { x, y, w, h } = annot.rect;
      const common = {
        fill: annot.fill ? cssColor(annot.fill) : 'none',
        stroke,
        strokeWidth: annot.width * zoom,
      };
      return annot.type === 'rect' ? (
        <rect x={x * zoom} y={y * zoom} width={w * zoom} height={h * zoom} {...common} />
      ) : (
        <ellipse
          cx={(x + w / 2) * zoom}
          cy={(y + h / 2) * zoom}
          rx={(w / 2) * zoom}
          ry={(h / 2) * zoom}
          {...common}
        />
      );
    }
    case 'line':
    case 'arrow':
      return (
        <line
          x1={annot.a.x * zoom}
          y1={annot.a.y * zoom}
          x2={annot.b.x * zoom}
          y2={annot.b.y * zoom}
          stroke={stroke}
          strokeWidth={annot.width * zoom}
          markerEnd={annot.type === 'arrow' ? 'url(#arrowhead)' : undefined}
        />
      );
    case 'ink':
      return (
        <>
          {annot.paths.map((path, i) => (
            <polyline
              key={i}
              points={path.map((p) => `${p.x * zoom},${p.y * zoom}`).join(' ')}
              fill="none"
              stroke={stroke}
              strokeWidth={annot.width * zoom}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </>
      );
    default:
      return null;
  }
}

export function Overlay({ page, zoom }: { page: PageInfo; zoom: number }) {
  const objects = useEditor((s) => s.objects);
  const commit = useEditor((s) => s.commit);
  const getTextRuns = useEditor((s) => s.getTextRuns);
  const selectText = useEditor((s) => s.selectText);
  const tool = useTools((s) => s.tool);
  const selectedId = useTools((s) => s.selectedId);
  const draft = useTools((s) => s.draft);
  const shape = useTools((s) => s.shape);
  const ink = useTools((s) => s.ink);
  const select = useTools((s) => s.select);
  const setDraft = useTools((s) => s.setDraft);

  const layer = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const runs = useRef<TextRun[]>([]);
  const [preview, setPreview] = useState<{
    annot?: AnnotSpec;
    quads?: Quad[];
    moved?: EditorObject;
    guides?: Guide[];
  }>({});

  // Keep this page's text runs at hand for snapping and new-text defaults.
  const version = useEditor((s) => s.pageVersions[page.index] ?? 0);
  useEffect(() => {
    let live = true;
    getTextRuns(page.index).then(
      (r) => {
        if (live) runs.current = r;
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [getTextRuns, page.index, version]);

  const pageObjects = useMemo(
    () => objects.filter((o) => o.page === page.index),
    [objects, page.index],
  );
  const selected = pageObjects.find((o) => o.id === selectedId);

  const toPage = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const r = layer.current!.getBoundingClientRect();
      return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
    },
    [zoom],
  );

  const markupPreview = useRef(0);
  const updateMarkup = (start: Point, end: Point) => {
    const ticket = ++markupPreview.current;
    selectText(page.index, start, end).then(
      (quads) => {
        if (ticket === markupPreview.current && gesture.current?.kind === 'markup')
          setPreview({ quads });
      },
      () => undefined,
    );
  };

  const startText = (p: Point) => {
    const near = nearestRun(runs.current, p);
    const style =
      near && Math.abs(near.baseline - p.y) < 200 ? styleFromRun(near) : DEFAULT_TEXT_STYLE;
    const offset = firstBaselineOffset(style.family, style.size);
    // The click point is where the first baseline goes, snapped to nearby text.
    const raw: Rect = { x: p.x, y: p.y - offset, w: 4, h: style.size * 1.2 };
    const { box } = snapBox(
      raw,
      offset,
      snapTargets(runs.current, objects, page.index),
      SNAP_PX / zoom,
    );
    setDraft({ id: newId(), page: page.index, isNew: true, spec: { box, text: '', style } });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || draft) return;
    // Keep focus where it is (e.g. a new text editor must not be blurred by this click).
    e.preventDefault();
    const p = toPage(e);
    const hit = hitTest(pageObjects, page.index, p, HIT_PX / zoom);
    e.currentTarget.setPointerCapture(e.pointerId);

    switch (tool) {
      case 'select':
        select(hit?.id ?? null);
        if (hit) gesture.current = { kind: 'move', object: hit, start: p, moved: false };
        return;
      case 'text':
        if (hit?.kind === 'text') {
          select(null);
          setDraft({ id: hit.id, page: page.index, isNew: false, spec: hit.spec });
        } else {
          startText(p);
        }
        return;
      case 'highlight':
      case 'underline':
      case 'strikeout':
        gesture.current = { kind: 'markup', tool, start: p };
        return;
      case 'ink':
        gesture.current = { kind: 'ink', points: [p] };
        return;
      case 'rect':
      case 'ellipse':
      case 'line':
      case 'arrow':
        gesture.current = { kind: 'shape', tool, start: p, end: p };
        return;
      case 'note': {
        const id = newId();
        void commit({
          kind: 'annot.add',
          id,
          page: page.index,
          annot: { type: 'note', at: { x: p.x - 10, y: p.y - 10 }, text: '', color: [1, 0.8, 0.2] },
        }).then(() => {
          useTools.getState().setTool('select');
          select(id);
        });
        return;
      }
    }
  };

  const shapeAnnot = (g: Extract<Gesture, { kind: 'shape' }>): AnnotSpec => {
    const style = { color: shape.color, width: shape.width, opacity: shape.opacity };
    if (g.tool === 'line' || g.tool === 'arrow')
      return { type: g.tool, a: g.start, b: g.end, ...style };
    return { type: g.tool, rect: normalize(g.start, g.end), fill: shape.fill, ...style };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const p = toPage(e);
    switch (g.kind) {
      case 'move': {
        const dx = p.x - g.start.x;
        const dy = p.y - g.start.y;
        if (!g.moved && Math.hypot(dx, dy) * zoom < 3) return;
        g.moved = true;
        let moved = translate(g.object, dx, dy);
        const b = objectBounds(moved);
        const offset =
          moved.kind === 'text'
            ? firstBaselineOffset(moved.spec.style.family, moved.spec.style.size)
            : b.h;
        const { box, guides } = e.altKey
          ? { box: b, guides: [] }
          : snapBox(
              b,
              offset,
              snapTargets(runs.current, objects, page.index, g.object),
              SNAP_PX / zoom,
            );
        moved = translate(moved, box.x - b.x, box.y - b.y);
        setPreview({ moved, guides });
        return;
      }
      case 'markup':
        updateMarkup(g.start, p);
        return;
      case 'ink': {
        const last = g.points[g.points.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) < 0.75) return;
        g.points.push(p);
        setPreview({ annot: { type: 'ink', paths: [g.points.slice()], ...ink } });
        return;
      }
      case 'shape':
        g.end = e.shiftKey ? constrain(g.tool, g.start, p) : p;
        setPreview({ annot: shapeAnnot(g) });
        return;
    }
  };

  const onPointerUp = async (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const p = toPage(e);
    switch (g.kind) {
      case 'move':
        if (g.moved && preview.moved) await commit(annotOpFor(preview.moved, 'update'));
        break;
      case 'markup': {
        const quads = await selectText(page.index, g.start, p);
        if (quads.length) {
          await commit({
            kind: 'annot.add',
            id: newId(),
            page: page.index,
            annot: {
              type: g.tool,
              quads,
              color: MARKUP_COLORS[g.tool],
              opacity: g.tool === 'highlight' ? 0.5 : 1,
            },
          });
        }
        break;
      }
      case 'ink':
        if (g.points.length > 1) {
          await commit({
            kind: 'annot.add',
            id: newId(),
            page: page.index,
            annot: { type: 'ink', paths: [g.points], ...ink },
          });
        }
        break;
      case 'shape': {
        const annot = shapeAnnot(g);
        const b =
          annot.type === 'line' || annot.type === 'arrow'
            ? normalize(annot.a, annot.b)
            : normalize(g.start, g.end);
        if (Math.max(b.w, b.h) > 2)
          await commit({ kind: 'annot.add', id: newId(), page: page.index, annot });
        break;
      }
    }
    setPreview({});
  };

  const commitDraft = useCallback(
    async (spec: TextSpec | null) => {
      const current = useTools.getState().draft;
      setDraft(null);
      if (!current) return;
      const text = spec?.text ?? '';
      if (!spec || !text.trim()) {
        if (!current.isNew)
          await commit({ kind: 'text.delete', id: current.id, page: current.page });
        return;
      }
      await commit(
        current.isNew
          ? { kind: 'text.add', id: current.id, page: current.page, spec }
          : { kind: 'text.update', id: current.id, page: current.page, spec },
      );
      select(current.id);
    },
    [commit, select, setDraft],
  );

  const cursor: Record<Tool, string> = {
    select: 'default',
    text: 'text',
    highlight: 'text',
    underline: 'text',
    strikeout: 'text',
    ink: 'crosshair',
    rect: 'crosshair',
    ellipse: 'crosshair',
    line: 'crosshair',
    arrow: 'crosshair',
    note: 'copy',
  };

  const shownSelection = preview.moved ?? selected;
  const selectionBox = shownSelection ? objectBounds(shownSelection) : null;

  return (
    <div
      ref={layer}
      data-testid="overlay"
      className="absolute inset-0 touch-none select-none"
      style={{ cursor: cursor[tool] }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => void onPointerUp(e)}
      onDoubleClick={(e) => {
        const hit = hitTest(pageObjects, page.index, toPage(e), HIT_PX / zoom);
        if (tool === 'select' && hit?.kind === 'text') {
          select(null);
          setDraft({ id: hit.id, page: page.index, isNew: false, spec: hit.spec });
        }
      }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10" fill="none" stroke="context-stroke" strokeWidth="2" />
          </marker>
        </defs>
        {preview.quads?.map((q, i) => (
          <path key={i} d={quadPath(q, zoom)} fill="rgb(37 99 235 / 0.25)" />
        ))}
        {preview.annot && <ShapePreview annot={preview.annot} zoom={zoom} />}
        {preview.moved?.kind === 'annot' && (
          <ShapePreview annot={preview.moved.annot} zoom={zoom} />
        )}
        {preview.guides?.map((g, i) =>
          g.axis === 'x' ? (
            <line
              key={i}
              data-testid="guide"
              x1={g.at * zoom}
              x2={g.at * zoom}
              y1={g.from * zoom}
              y2={g.to * zoom}
              stroke="#db2777"
              strokeWidth={1}
            />
          ) : (
            <line
              key={i}
              data-testid="guide"
              y1={g.at * zoom}
              y2={g.at * zoom}
              x1={g.from * zoom}
              x2={g.to * zoom}
              stroke="#db2777"
              strokeWidth={1}
            />
          ),
        )}
        {selectionBox && (
          <rect
            data-testid="selection"
            x={selectionBox.x * zoom - 3}
            y={selectionBox.y * zoom - 3}
            width={selectionBox.w * zoom + 6}
            height={selectionBox.h * zoom + 6}
            fill="none"
            stroke="#2563eb"
            strokeWidth={1.5}
            strokeDasharray={preview.moved ? '4 3' : undefined}
          />
        )}
      </svg>
      {draft && draft.page === page.index && (
        <TextEditor
          key={draft.id}
          draft={draft}
          zoom={zoom}
          measure={measureTextWidth}
          onCommit={commitDraft}
        />
      )}
    </div>
  );
}
