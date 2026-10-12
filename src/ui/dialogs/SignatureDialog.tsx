import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { fitWithin, removeBackground, smoothStroke, trimTransparent } from '../../editor/signature';
import { useEditor } from '../../editor/store';
import { useTools } from '../../editor/tools';
import { SCRIPT_FONTS, type ScriptFont } from '../../shared/fonts';
import type { Point } from '../../shared/types';

type Tab = 'draw' | 'type' | 'upload';

const PAD_W = 560;
const PAD_H = 200;
const INKS = [
  { name: 'Black', css: '#111827' },
  { name: 'Blue', css: '#1d4ed8' },
];
const MAX_UPLOAD_PX = 2000;

/** PNG bytes of the visible part of a canvas (transparent margins trimmed). */
async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const box = trimTransparent(ctx.getImageData(0, 0, width, height).data, width, height);
  if (!box) return null;
  const pad = 4;
  const out = document.createElement('canvas');
  out.width = box.w + pad * 2;
  out.height = box.h + pad * 2;
  out.getContext('2d')!.drawImage(canvas, box.x, box.y, box.w, box.h, pad, pad, box.w, box.h);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

function strokePath(ctx: CanvasRenderingContext2D, points: Point[]) {
  const smooth = smoothStroke(points);
  ctx.beginPath();
  ctx.moveTo(smooth[0]!.x, smooth[0]!.y);
  if (smooth.length === 1) ctx.lineTo(smooth[0]!.x + 0.1, smooth[0]!.y);
  for (const p of smooth.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

function DrawPad({
  ink,
  canvasRef,
}: {
  ink: string;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}) {
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const scale = 2; // render at 2x for a crisp signature

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes.current) strokePath(ctx, s);
  };
  useEffect(redraw);

  const point = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * PAD_W,
      y: ((e.clientY - r.top) / r.height) * PAD_H,
    };
  };

  return (
    <div className="relative rounded-lg border border-slate-300 bg-white">
      <canvas
        ref={canvasRef}
        data-testid="signature-pad"
        aria-label="Signature pad: draw your signature"
        width={PAD_W * scale}
        height={PAD_H * scale}
        className="block w-full touch-none"
        style={{ aspectRatio: `${PAD_W} / ${PAD_H}` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          strokes.current.push([point(e)]);
          setEmpty(false);
          redraw();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          strokes.current[strokes.current.length - 1]!.push(point(e));
          redraw();
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      />
      <div className="pointer-events-none absolute right-6 bottom-12 left-6 border-b border-dashed border-slate-300" />
      <span className="pointer-events-none absolute bottom-12 left-6 text-slate-400">×</span>
      <button
        type="button"
        disabled={empty}
        onClick={() => {
          strokes.current = [];
          setEmpty(true);
          redraw();
        }}
        className="absolute bottom-2 left-3 text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40"
      >
        Clear
      </button>
    </div>
  );
}

function TypePad({
  ink,
  canvasRef,
}: {
  ink: string;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}) {
  const [name, setName] = useState('');
  const [font, setFont] = useState<ScriptFont>('Dancing Script');
  const inputId = useId();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = ink;
    ctx.font = `120px "${font}"`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(name, 20, canvas.height * 0.68, canvas.width - 40);
  }, [name, font, ink, canvasRef]);

  return (
    <div className="space-y-3">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
        Your name
      </label>
      <input
        id={inputId}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <div role="radiogroup" aria-label="Signature style" className="flex gap-2">
        {SCRIPT_FONTS.map((f) => (
          <button
            key={f.family}
            type="button"
            role="radio"
            aria-checked={font === f.family}
            onClick={() => setFont(f.family)}
            className={`flex-1 rounded-md border px-3 py-2 text-2xl ${font === f.family ? 'border-blue-600 bg-blue-50' : 'border-slate-200'}`}
            style={{ fontFamily: `"${f.family}"` }}
          >
            {name || 'Signature'}
          </button>
        ))}
      </div>
      <canvas ref={canvasRef} width={PAD_W * 2} height={PAD_H * 2} className="hidden" />
    </div>
  );
}

function UploadPad({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement> }) {
  const [source, setSource] = useState<ImageData | null>(null);
  const [removeBg, setRemoveBg] = useState(true);
  const [threshold, setThreshold] = useState(200);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const data = removeBg ? removeBackground(source.data, threshold) : source.data;
    canvas
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(data), source.width, source.height), 0, 0);
  }, [source, removeBg, threshold, canvasRef]);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_UPLOAD_PX);
      const scratch = document.createElement('canvas');
      scratch.width = width;
      scratch.height = height;
      const ctx = scratch.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      setSource(ctx.getImageData(0, 0, width, height));
    } catch {
      setError('That file could not be read as an image.');
    }
  };

  return (
    <div className="space-y-3">
      <input
        type="file"
        aria-label="Signature image"
        accept="image/png,image/jpeg"
        onChange={(e) => void load(e.target.files?.[0])}
        className="block w-full text-sm"
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2">
        <canvas ref={canvasRef} data-testid="upload-preview" className="max-h-40 max-w-full" />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} />
        Remove background
      </label>
      {removeBg && (
        <label className="flex items-center gap-3 text-sm text-slate-700">
          Threshold
          <input
            type="range"
            aria-label="Background threshold"
            min={100}
            max={250}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="flex-1"
          />
        </label>
      )}
    </div>
  );
}

export function SignatureDialog() {
  const open = useTools((s) => s.signatureDialogOpen);
  const setOpen = useTools((s) => s.setSignatureDialogOpen);
  const addSignature = useTools((s) => s.addSignature);
  const setPending = useTools((s) => s.setPending);
  const setTool = useTools((s) => s.setTool);
  const addImage = useEditor((s) => s.addImage);
  const showToast = useEditor((s) => s.showToast);
  const [tab, setTab] = useState<Tab>('draw');
  const [ink, setInk] = useState(INKS[0]!.css);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const titleId = useId();

  if (!open) return null;

  const use = async () => {
    if (!canvas.current) return;
    setBusy(true);
    try {
      const png = await canvasToPng(canvas.current);
      if (!png) {
        showToast('The signature is empty.');
        return;
      }
      const asset = await addImage(png);
      addSignature(asset);
      setTool('sign');
      setPending({ asset, kind: 'signature' });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'draw', label: 'Draw' },
    { id: 'type', label: 'Type' },
    { id: 'upload', label: 'Upload' },
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            Add signature
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="text-slate-500 hover:text-slate-900"
          >
            ×
          </button>
        </div>
        <div role="tablist" className="mt-4 flex gap-6 border-b border-slate-200">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 pb-2 text-sm font-medium ${tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-4">
          {tab === 'draw' && <DrawPad ink={ink} canvasRef={canvas} />}
          {tab === 'type' && <TypePad ink={ink} canvasRef={canvas} />}
          {tab === 'upload' && <UploadPad canvasRef={canvas} />}
        </div>
        {tab !== 'upload' && (
          <div role="group" aria-label="Ink color" className="mt-3 flex gap-2">
            {INKS.map((i) => (
              <button
                key={i.name}
                type="button"
                aria-label={i.name}
                aria-pressed={ink === i.css}
                onClick={() => setInk(i.css)}
                className={`h-6 w-6 rounded-full ${ink === i.css ? 'ring-2 ring-blue-600 ring-offset-2' : ''}`}
                style={{ background: i.css }}
              />
            ))}
          </div>
        )}
        <p className="mt-4 text-sm text-slate-500">
          Signatures stay in this tab and are forgotten when you close it.
        </p>
        <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void use()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Use signature
          </button>
        </div>
      </div>
    </div>
  );
}
