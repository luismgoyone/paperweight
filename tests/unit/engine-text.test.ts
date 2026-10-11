import { describe, expect, it } from 'vitest';
import { EngineSession } from '../../src/engine/document';
import { selectText, textRuns } from '../../src/engine/text';
import { fixture } from './helpers';

function open(name: string) {
  const s = new EngineSession();
  s.open(fixture(name));
  return s.doc;
}

describe('textRuns', () => {
  const runs = textRuns(open('invoice.pdf'), 0);
  // `$26` and `$14` appear in both the Rate and Amount columns; take the rightmost.
  const run = (text: string) => runs.filter((r) => r.text === text).sort((a, b) => b.x1 - a.x1)[0]!;

  it('finds each cell of the invoice as its own run', () => {
    expect(run('$26')).toBeDefined();
    expect(run('Monthly hosting')).toBeDefined();
    expect(run('Amount')).toBeDefined();
  });

  it('reports font, size, color and baseline', () => {
    const r = run('$26');
    expect(r.font).toMatch(/Helvetica/);
    expect(r.size).toBeCloseTo(10, 3);
    expect(r.color).toEqual([0, 0, 0]);
    // Drawn at PDF y=596 on a 792pt page -> page-space baseline 196.
    expect(r.baseline).toBeCloseTo(196, 1);
  });

  it('right-aligned amounts share the same right edge', () => {
    const edges = ['$26', '$14', '$120', '$160'].map((t) => run(t).x1);
    for (const e of edges) expect(e).toBeCloseTo(540, 1);
  });

  it('left-aligned descriptions share the same left edge', () => {
    expect(run('Monthly hosting').x0).toBeCloseTo(72, 1);
    expect(run('Domain renewal').x0).toBeCloseTo(72, 1);
  });

  it('works on an offset MediaBox page in page space', () => {
    const r = textRuns(open('rotated.pdf'), 1).find((x) => x.text === 'Offset page')!;
    expect(r.x0).toBeCloseTo(72, 1);
    expect(r.baseline).toBeCloseTo(842 - 770, 1);
  });
});

describe('selectText', () => {
  const doc = open('invoice.pdf');

  it('selects the text between two points', () => {
    const quads = selectText(doc, 0, { x: 70, y: 192 }, { x: 160, y: 192 });
    expect(quads.length).toBeGreaterThan(0);
    const xs = quads.flatMap((q) => q.map((p) => p.x));
    expect(Math.min(...xs)).toBeCloseTo(72, 0);
  });

  it('spans lines when the drag crosses them', () => {
    const quads = selectText(doc, 0, { x: 72, y: 192 }, { x: 140, y: 210 });
    const ys = new Set(quads.map((q) => Math.round(q[0].y)));
    expect(ys.size).toBeGreaterThanOrEqual(2);
  });

  it('returns nothing for a drag in empty space', () => {
    expect(selectText(doc, 0, { x: 300, y: 700 }, { x: 350, y: 720 })).toEqual([]);
  });
});
