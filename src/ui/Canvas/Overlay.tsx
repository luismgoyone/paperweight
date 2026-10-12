import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { newId } from '../../editor/ids';
import { hitTest, objectBounds, translate, type EditorObject } from '../../editor/objects';
import { snapBox, type Guide, type SnapTarget } from '../../editor/snapping';
import { objectOp } from '../../editor/object-ops';
import { useEditor } from '../../editor/store';
import { editSpecFor, nearestRun, styleFromRun } from '../../editor/text-defaults';
import { DEFAULT_TEXT_STYLE, MARKUP_COLORS, useTools, type Tool } from '../../editor/tools';
import { firstBaselineOffset } from '../../shared/fonts';
import type { AnnotSpec, PageInfo, Point, Quad, Rect, TextRun, TextSpec } from '../../shared/types';
import { cssColor } from '../colors';
import { measureTextWidth } from '../measure';
import { FormLayer } from './FormLayer';
import { TextEditor } from './TextEditor';

const SNAP_PX = 6; // snap threshold in screen pixels
const HIT_PX = 4;

type Gesture =
  | { kind: 'move'; object: EditorObject; start: Point; moved: EditorObject | null }
  | { kind: 'markup'; tool: 'highlight' | 'underline' | 'strikeout'; start: Point }
  | { kind: 'ink'; points: Point[] }
  | { kind: 'shape'; tool: 'rect' | 'ellipse' | 'line' | 'arrow'; start: Point; end: Point }
  | {
      kind: 'resize';
      object: EditorObject & { kind: 'image' };
      corner: Corner;
      resized: Rect | null;
    };

type Corner = 'nw' | 'ne' | 'sw' | 'se';

const SIGNATURE_WIDTH = 150; // default placed width in points
const MAX_IMAGE_WIDTH = 300;

/**
 * Resizes a box by dragging one corner, keeping its aspect ratio; the opposite corner stays
 * put. The pointer is projected onto the box's diagonal, so dragging in any direction works.
 */
function resizeBox(box: Rect, corner: Corner, p: Point): Rect {
  const fixed = {
    x: corner.includes('w') ? box.x + box.w : box.x,
    y: corner.includes('n') ? box.y + box.h : box.y,
  };
  const dx = Math.abs(p.x - fixed.x);
  const dy = Math.abs(p.y - fixed.y);
  const scale = (dx * box.w + dy * box.h) / (box.w * box.w + box.h * box.h);
  const w = Math.max(8, box.w * scale);
  const h = (w * box.h) / box.w;
  return {
    x: corner.includes('w') ? fixed.x - w : fixed.x,
    y: corner.includes('n') ? fixed.y - h : fixed.y,
    w,
    h,
  };
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
  const pending = useTools((s) => s.pending);
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

  // The PDF's own text under a point (not text the user added: that is edited as an object).
  const [hover, setHover] = useState<TextRun | null>(null);
  const runAt = (p: Point): TextRun | null => {
    const pad = 1;
    const run = runs.current.find(
      (r) =>
        p.x >= r.bbox.x - pad &&
        p.x <= r.bbox.x + r.bbox.w + pad &&
        p.y >= r.bbox.y - pad &&
        p.y <= r.bbox.y + r.bbox.h + pad,
    );
    if (!run) return null;
    // Text the user added or already edited is drawn in its real font, which can be wider than
    // the box measured with the bundled one: treat any substantial overlap as ours.
    const ours = pageObjects.some((o) => {
      if (o.kind !== 'text') return false;
      const b = objectBounds(o);
      const w = Math.min(run.bbox.x + run.bbox.w, b.x + b.w) - Math.max(run.bbox.x, b.x);
      const h = Math.min(run.bbox.y + run.bbox.h, b.y + b.h) - Math.max(run.bbox.y, b.y);
      return w > 0 && h > 0 && w * h >= 0.3 * run.bbox.w * run.bbox.h;
    });
    return ours ? null : run;
  };

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
    setDraft({
      id: newId(),
      page: page.index,
      isNew: true,
      original: null,
      spec: { box, text: '', style },
    });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || draft) return;
    // Form mode has no page gestures; let a tap on the page blur (and so commit) a field.
    if (tool === 'form') return;
    // Keep focus where it is (e.g. a new text editor must not be blurred by this click).
    e.preventDefault();
    const p = toPage(e);
    const hit = hitTest(pageObjects, page.index, p, HIT_PX / zoom);
    e.currentTarget.setPointerCapture(e.pointerId);

    switch (tool) {
      case 'select':
        select(hit?.id ?? null);
        if (hit) gesture.current = { kind: 'move', object: hit, start: p, moved: null };
        return;
      case 'edit': {
        if (hit?.kind === 'text') {
          select(null);
          setDraft({
            id: hit.id,
            page: page.index,
            isNew: false,
            original: hit.spec,
            spec: hit.spec,
          });
          return;
        }
        const run = runAt(p);
        if (!run) return;
        select(null);
        setHover(null);
        setDraft({
          id: newId(),
          page: page.index,
          isNew: true,
          original: null,
          edit: { target: { text: run.text, bbox: run.bbox } },
          spec: editSpecFor(run, runs.current, measureTextWidth),
        });
        return;
      }
      case 'text':
        if (hit?.kind === 'text') {
          select(null);
          setDraft({
            id: hit.id,
            page: page.index,
            isNew: false,
            original: hit.spec,
            spec: hit.spec,
          });
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
      case 'sign':
      case 'image': {
        const pending = useTools.getState().pending;
        if (!pending) {
          if (tool === 'sign') useTools.getState().setSignatureDialogOpen(true);
          return;
        }
        const { asset } = pending;
        // A picked image is placed once: clear it now so a quick double tap can't place it twice.
        if (pending.kind === 'image') useTools.getState().setPending(null);
        const width =
          pending.kind === 'signature'
            ? SIGNATURE_WIDTH
            : Math.min(MAX_IMAGE_WIDTH, asset.width * 0.75, page.width - 20);
        const height = (width * asset.height) / asset.width;
        const id = newId();
        // Centered on the click, kept inside the page.
        const box = {
          x: Math.min(Math.max(0, p.x - width / 2), Math.max(0, page.width - width)),
          y: Math.min(Math.max(0, p.y - height / 2), Math.max(0, page.height - height)),
          w: width,
          h: height,
        };
        void commit({ kind: 'image.add', id, page: page.index, box, image: asset.key }).then(() => {
          // Signatures can be placed again (the picker stays up); a picked image is placed once.
          if (pending.kind === 'image') {
            useTools.getState().setTool('select');
            select(id);
          }
        });
        return;
      }
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
    if (!g) {
      // Edit text: show which run a click would edit.
      if (tool === 'edit' && !draft) {
        const run = runAt(toPage(e));
        if (run !== hover) setHover(run);
      }
      return;
    }
    const p = toPage(e);
    switch (g.kind) {
      case 'move': {
        const dx = p.x - g.start.x;
        const dy = p.y - g.start.y;
        if (!g.moved && Math.hypot(dx, dy) * zoom < 3) return;
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
        g.moved = moved;
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
      case 'resize':
        g.resized = resizeBox(g.object.box, g.corner, p);
        setPreview({ moved: { ...g.object, box: g.resized } });
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
        if (g.moved) await commit(objectOp(g.moved, 'update'));
        break;
      case 'resize':
        if (g.resized) await commit(objectOp({ ...g.object, box: g.resized }, 'update'));
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

  /** `spec` null = cancel. Cancelling, or closing unchanged text, commits nothing. */
  const commitDraft = useCallback(
    async (spec: TextSpec | null) => {
      const current = useTools.getState().draft;
      setDraft(null);
      if (!current || !spec) return;
      if (current.edit) {
        // Unchanged text (and style): nothing to do. Emptying a run removes it.
        const unchanged =
          spec.text === current.edit.target.text &&
          JSON.stringify(spec.style) === JSON.stringify(current.spec.style);
        if (unchanged) return;
        await commit({
          kind: 'text.edit',
          id: current.id,
          page: current.page,
          target: current.edit.target,
          spec,
        });
        if (spec.text.trim()) select(current.id);
        return;
      }
      if (!spec.text.trim()) {
        if (!current.isNew)
          await commit({ kind: 'text.delete', id: current.id, page: current.page });
        return;
      }
      if (current.original && JSON.stringify(current.original) === JSON.stringify(spec)) {
        select(current.id);
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

  const cancelGesture = () => {
    gesture.current = null;
    setPreview({});
  };

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
    sign: 'copy',
    image: 'copy',
    form: 'default',
    edit: 'text',
  };

  const nudge = useTools((s) => s.nudge);
  const nudged =
    selected && nudge?.id === selected.id ? translate(selected, nudge.dx, nudge.dy) : undefined;
  const moving = preview.moved ?? nudged;
  const shownSelection = moving ?? selected;
  const selectionBox = shownSelection ? objectBounds(shownSelection) : null;

  return (
    <div
      ref={layer}
      data-testid="overlay"
      className="absolute inset-0 select-none"
      style={{
        cursor: cursor[tool],
        // Tools without page gestures leave one-finger scrolling and pinch zoom to the browser
        // (spec §2: form filling and signing must work on phones).
        touchAction:
          tool === 'form' || (tool === 'sign' && !pending) ? 'pan-x pan-y pinch-zoom' : 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => void onPointerUp(e)}
      onPointerCancel={cancelGesture}
      onLostPointerCapture={() => {
        // Capture is also released after pointerup; only reset if a gesture is still open.
        if (gesture.current) cancelGesture();
      }}
      onDoubleClick={(e) => {
        const hit = hitTest(pageObjects, page.index, toPage(e), HIT_PX / zoom);
        if (tool === 'select' && hit?.kind === 'text') {
          select(null);
          setDraft({
            id: hit.id,
            page: page.index,
            isNew: false,
            original: hit.spec,
            spec: hit.spec,
          });
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
        {moving?.kind === 'annot' && <ShapePreview annot={moving.annot} zoom={zoom} />}
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
        {tool === 'edit' && hover && !draft && (
          <rect
            data-testid="edit-hover"
            x={hover.bbox.x * zoom - 2}
            y={hover.bbox.y * zoom - 2}
            width={hover.bbox.w * zoom + 4}
            height={hover.bbox.h * zoom + 4}
            fill="rgb(37 99 235 / 0.08)"
            stroke="#2563eb"
            strokeDasharray="3 2"
          />
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
            strokeDasharray={moving ? '4 3' : undefined}
          />
        )}
      </svg>
      {tool === 'select' && shownSelection?.kind === 'image' && (
        <>
          {(['nw', 'ne', 'sw', 'se'] as Corner[]).map((corner) => {
            const b = shownSelection.box;
            const x = corner.includes('w') ? b.x : b.x + b.w;
            const y = corner.includes('n') ? b.y : b.y + b.h;
            return (
              <div
                key={corner}
                data-testid={`handle-${corner}`}
                aria-hidden
                // 28 px touch target around a 10 px visible handle.
                className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                style={{
                  left: x * zoom,
                  top: y * zoom,
                  cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0 || !selected || selected.kind !== 'image') return;
                  e.stopPropagation();
                  e.preventDefault();
                  layer.current!.setPointerCapture(e.pointerId);
                  gesture.current = { kind: 'resize', object: selected, corner, resized: null };
                }}
              >
                <span className="pointer-events-none h-2.5 w-2.5 border border-blue-600 bg-white" />
              </div>
            );
          })}
        </>
      )}
      {tool === 'form' && <FormLayer page={page} zoom={zoom} />}
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
