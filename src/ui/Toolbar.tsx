import { Fragment, type ReactNode } from 'react';
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

type ToolDef = { tool: Tool; label: string; shortcut?: string; icon: ReactNode };

// Grouped as in spec §5. Tools from later phases are hidden, not disabled.
const GROUPS: ToolDef[][] = [
  [
    {
      tool: 'select',
      label: 'Select',
      shortcut: 'V',
      icon: svg(<path d="m4 3 7 17 2.5-7.5L21 10z" />),
    },
  ],
  [
    {
      tool: 'text',
      label: 'Add text',
      shortcut: 'T',
      icon: svg(<path d="M5 6V4h14v2M12 4v16M9 20h6" />),
    },
  ],
  [
    {
      tool: 'highlight',
      label: 'Highlight',
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
      icon: svg(<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />),
    },
    {
      tool: 'rect',
      label: 'Rectangle',
      icon: svg(<rect x="3" y="5" width="18" height="14" rx="1" />),
    },
    { tool: 'ellipse', label: 'Ellipse', icon: svg(<ellipse cx="12" cy="12" rx="9" ry="7" />) },
    { tool: 'line', label: 'Line', icon: svg(<path d="M5 19 19 5" />) },
    {
      tool: 'arrow',
      label: 'Arrow',
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
      icon: svg(
        <>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </>,
      ),
    },
  ],
];

export function Toolbar() {
  const tool = useTools((s) => s.tool);
  const setTool = useTools((s) => s.setTool);

  return (
    <div
      role="toolbar"
      aria-label="Tools"
      className="flex h-11 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-3"
    >
      {GROUPS.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="mx-1.5 h-5 w-px bg-slate-200" />}
          {group.map((t) => (
            <button
              key={t.tool}
              type="button"
              aria-label={t.label}
              aria-pressed={tool === t.tool}
              title={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}
              onClick={() => setTool(t.tool)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${
                tool === t.tool
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {t.icon}
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
