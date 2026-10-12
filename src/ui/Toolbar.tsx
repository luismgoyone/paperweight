import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { fitWithin } from '../editor/signature';
import { useEditor } from '../editor/store';
import { useTools, type Tool } from '../editor/tools';

const svg = (children: ReactNode) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

type ToolDef = { tool: Tool; label: string; hint: string; shortcut?: string; icon: ReactNode };

// Grouped as in spec §5. Tools from later phases are hidden, not disabled.
const GROUPS: ToolDef[][] = [
  [
    {
      tool: 'select',
      label: 'Select',
      hint: 'Select, move and resize',
      shortcut: 'V',
      icon: svg(<path d="m4 3 7 17 2.5-7.5L21 10z" />),
    },
  ],
  [
    {
      tool: 'edit',
      label: 'Edit text',
      hint: 'Click a line of text to change it',
      shortcut: 'E',
      icon: svg(
        <>
          <path d="M4 7V5h10v2M9 5v12M6 17h6" />
          <path d="M14 19l6-6-2-2-6 6v2z" />
        </>,
      ),
    },
    {
      tool: 'text',
      label: 'Add text',
      hint: 'Click to place a text box',
      shortcut: 'T',
      icon: svg(<path d="M5 6V4h14v2M12 4v16M9 20h6" />),
    },
  ],
  [
    {
      tool: 'highlight',
      label: 'Highlight',
      hint: 'Drag across text',
      shortcut: 'H',
      icon: svg(
        <>
          <path d="m9 11-6 6v3h9l3-3" />
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
        </>,
      ),
    },
    {
      tool: 'underline',
      label: 'Underline',
      hint: 'Drag across text',
      icon: svg(
        <>
          <path d="M6 4v6a6 6 0 0 0 12 0V4" />
          <path d="M4 20h16" />
        </>,
      ),
    },
    {
      tool: 'strikeout',
      label: 'Strikethrough',
      hint: 'Drag across text',
      icon: svg(
        <>
          <path d="M16 4H9a3 3 0 0 0-2.83 4" />
          <path d="M14 12a4 4 0 0 1 0 8H6" />
          <path d="M4 12h16" />
        </>,
      ),
    },
  ],
  [
    {
      tool: 'ink',
      label: 'Pen',
      hint: 'Draw freehand',
      icon: svg(<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />),
    },
    {
      tool: 'rect',
      label: 'Rectangle',
      hint: 'Drag to draw; Shift for a square',
      icon: svg(<rect x="3" y="5" width="18" height="14" rx="1" />),
    },
    {
      tool: 'ellipse',
      label: 'Ellipse',
      hint: 'Drag to draw; Shift for a circle',
      icon: svg(<ellipse cx="12" cy="12" rx="9" ry="7" />),
    },
    {
      tool: 'line',
      label: 'Line',
      hint: 'Drag to draw; Shift snaps to 45°',
      icon: svg(<path d="M5 19 19 5" />),
    },
    {
      tool: 'arrow',
      label: 'Arrow',
      hint: 'Drag to draw; Shift snaps to 45°',
      icon: svg(
        <>
          <path d="M5 19 19 5" />
          <path d="M10 5h9v9" />
        </>,
      ),
    },
    {
      tool: 'note',
      label: 'Note',
      hint: 'Click to add a sticky note',
      icon: svg(
        <>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </>,
      ),
    },
  ],
  [
    {
      tool: 'sign',
      label: 'Sign',
      hint: 'Draw, type or upload a signature',
      icon: svg(<path d="M3 17c3-3 4-9 6-9s1 7 3 7 2-4 4-4 2 3 5 3M3 21h18" />),
    },
    {
      tool: 'form',
      label: 'Form fill',
      hint: 'Fill in the form fields',
      icon: svg(
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 9h6M7 13h10M7 17h4" />
        </>,
      ),
    },
    {
      tool: 'image',
      label: 'Image',
      hint: 'Insert a PNG or JPEG',
      icon: svg(
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-5-5L5 21" />
        </>,
      ),
    },
  ],
  [
    {
      tool: 'redact',
      label: 'Redact',
      hint: 'Mark areas to remove for good',
      icon: svg(
        <>
          <rect x="3" y="9" width="18" height="6" rx="1" fill="currentColor" />
          <path d="M3 5h8M3 19h12" />
        </>,
      ),
    },
  ],
];

const MAX_IMAGE_PX = 2000;
const TOOLTIP_DELAY = 400; // ms before the first tooltip; moving between tools is instant
const TOOLTIP_ID = 'tool-tooltip';

type Tip = { def: ToolDef; x: number; y: number };

/** Below the button, centred, kept inside the window. Fixed, so the scrolling bar can't clip it. */
function ToolTooltip({ tip, fontsReady }: { tip: Tip; fontsReady: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(tip.x);
  useEffect(() => {
    const w = ref.current?.offsetWidth ?? 0;
    setLeft(Math.min(Math.max(tip.x - w / 2, 8), window.innerWidth - w - 8));
  }, [tip]);
  const needsFonts = (tip.def.tool === 'text' || tip.def.tool === 'edit') && !fontsReady;
  return (
    <div
      ref={ref}
      id={TOOLTIP_ID}
      role="tooltip"
      className="pointer-events-none fixed z-50 max-w-60 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
      style={{ left, top: tip.y }}
    >
      <span className="flex items-center gap-2 font-medium">
        {tip.def.label}
        {tip.def.shortcut && (
          <kbd className="rounded border border-slate-600 px-1 font-sans text-[10px] text-slate-300">
            {tip.def.shortcut}
          </kbd>
        )}
      </span>
      <span className="block text-slate-300">{needsFonts ? 'Loading fonts…' : tip.def.hint}</span>
    </div>
  );
}

/** Reads a PNG/JPEG, downscaling anything larger than 2000 px on the long edge. */
async function readImage(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_PX);
  // PNGs that fit are embedded as is. JPEGs are always redrawn: the browser applies their EXIF
  // orientation when decoding, but a JPEG embedded in a PDF would ignore it (phone photos).
  if (width === bitmap.width && file.type === 'image/png') {
    bitmap.close();
    return new Uint8Array(await file.arrayBuffer());
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
  if (!blob) throw new Error('The image could not be read');
  return new Uint8Array(await blob.arrayBuffer());
}

export function Toolbar() {
  const tool = useTools((s) => s.tool);
  const setTool = useTools((s) => s.setTool);
  const fontsReady = useEditor((s) => s.fontsReady);
  const addImage = useEditor((s) => s.addImage);
  const showToast = useEditor((s) => s.showToast);
  const imageInput = useRef<HTMLInputElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const tipTimer = useRef<number | undefined>(undefined);
  const lastTipAt = useRef(0);

  // `at` is the event's timestamp: moving straight from one tool to the next shows at once.
  const showTip = (def: ToolDef, el: HTMLElement, at: number) => {
    window.clearTimeout(tipTimer.current);
    const r = el.getBoundingClientRect();
    const next = { def, x: r.left + r.width / 2, y: r.bottom + 6 };
    if (at - lastTipAt.current < 500) setTip(next);
    else tipTimer.current = window.setTimeout(() => setTip(next), TOOLTIP_DELAY);
  };
  const hideTip = (at: number) => {
    window.clearTimeout(tipTimer.current);
    if (tip) lastTipAt.current = at;
    setTip(null);
  };
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);

  const choose = (next: Tool) => {
    const tools = useTools.getState();
    if (next === 'image') {
      imageInput.current?.click();
      return;
    }
    setTool(next);
    if (next === 'sign' && tools.signatures.length === 0) tools.setSignatureDialogOpen(true);
    if (next === 'sign' && tools.signatures.length > 0 && !tools.pending) {
      tools.setPending({
        asset: tools.signatures[tools.signatures.length - 1]!,
        kind: 'signature',
      });
    }
  };

  const placeImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const asset = await addImage(await readImage(file));
      setTool('image');
      useTools.getState().setPending({ asset, kind: 'image' });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'The image could not be added');
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Tools"
      className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3"
    >
      <input
        ref={imageInput}
        type="file"
        data-testid="image-input"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          void placeImage(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {GROUPS.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="mx-1.5 h-5 w-px bg-slate-200" />}
          {group.map((t) => (
            // The wrapper gets hover events even while the button is disabled.
            <span
              key={t.tool}
              className="inline-flex"
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') showTip(t, e.currentTarget, e.timeStamp);
              }}
              onPointerLeave={(e) => hideTip(e.timeStamp)}
            >
              <button
                type="button"
                aria-label={t.label}
                aria-keyshortcuts={t.shortcut}
                aria-describedby={tip?.def.tool === t.tool ? TOOLTIP_ID : undefined}
                aria-pressed={tool === t.tool}
                // Text needs the bundled fonts, which load right after the page.
                disabled={(t.tool === 'text' || t.tool === 'edit') && !fontsReady}
                onClick={(e) => {
                  hideTip(e.timeStamp);
                  choose(t.tool);
                }}
                onFocus={(e) => {
                  if (e.currentTarget.matches(':focus-visible'))
                    showTip(t, e.currentTarget, e.timeStamp);
                }}
                onBlur={(e) => hideTip(e.timeStamp)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') hideTip(e.timeStamp);
                }}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${
                  tool === t.tool
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40'
                }`}
              >
                {t.icon}
              </button>
            </span>
          ))}
        </Fragment>
      ))}
      {tip && <ToolTooltip tip={tip} fontsReady={fontsReady} />}
    </div>
  );
}
