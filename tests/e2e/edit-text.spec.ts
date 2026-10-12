import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import * as mupdf from 'mupdf';
import { openApp, openFixture, pagePoint, zoom100 } from './helpers';

type Run = { text: string; x1: number; baseline: number; size: number; font: string };

function runs(doc: mupdf.Document): Run[] {
  const out: Run[] = [];
  let line: { c: string; q: number[]; o: number[]; f: string; s: number }[] = [];
  const flush = () => {
    // Split on wide gaps like the app does, so table cells are separate runs.
    let seg: typeof line = [];
    const push = () => {
      const vis = seg.filter((c) => c.c.trim());
      if (vis.length) {
        out.push({
          text: seg
            .map((c) => c.c)
            .join('')
            .trim(),
          x1: Math.max(...vis.map((c) => c.q[2]!)),
          baseline: vis[0]!.o[1]!,
          size: vis[0]!.s,
          font: vis[0]!.f,
        });
      }
      seg = [];
    };
    let last: number | null = null;
    for (const c of line) {
      if (last !== null && c.c.trim() && c.q[0]! - last > c.s * 1.5) push();
      seg.push(c);
      if (c.c.trim()) last = c.q[2]!;
    }
    push();
    line = [];
  };
  doc
    .loadPage(0)
    .toStructuredText('preserve-whitespace')
    .walk({
      onChar(c, o, f, s, q) {
        line.push({ c, q, o, f: f.getName(), s });
      },
      endLine: flush,
    });
  return out;
}

test('success criterion 1: change $26 to $31 in place on the invoice', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('fonts-ready')).toBeAttached();
  await openFixture(page, 'invoice.pdf');
  await expect(page.locator('[data-page="1"] canvas[data-rendered]')).toBeAttached();
  await zoom100(page);

  await page.getByRole('button', { name: 'Edit text' }).click();
  // The amount "$26" sits at x 522..540, baseline 196.
  const at = await pagePoint(page, 1, 531, 192);
  await page.mouse.move(at.x, at.y);
  await expect(page.getByTestId('edit-hover')).toBeVisible();
  await page.mouse.click(at.x, at.y);

  const editor = page.getByTestId('text-editor');
  await expect(editor).toHaveValue('$26');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('$31');
  await page.keyboard.press('Enter');
  await expect(editor).toBeHidden();
  await expect(page.getByTestId('font-notice')).toContainText('Same font as the document');

  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const doc = mupdf.Document.openDocument(
    readFileSync(await (await event).path()),
    'application/pdf',
  );
  const all = runs(doc);
  const edited = all.find((r) => r.text === '$31')!;
  expect(edited).toBeDefined();
  expect(Math.abs(edited.x1 - 540)).toBeLessThan(0.5);
  expect(Math.abs(edited.baseline - 196)).toBeLessThan(0.1);
  expect(edited.size).toBeCloseTo(10, 2);
  expect(edited.font).toMatch(/Helvetica|Nimbus/);
  // The Rate column's $26 is untouched; the Amount column's is gone.
  expect(all.filter((r) => r.text === '$26')).toHaveLength(1);
  expect(all.find((r) => r.text === '$26')!.x1).toBeLessThan(480);
});

test('Esc cancels an edit; undo restores the original text', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('fonts-ready')).toBeAttached();
  await openFixture(page, 'invoice.pdf');
  await zoom100(page);
  await page.getByRole('button', { name: 'Edit text' }).click();
  const at = await pagePoint(page, 1, 100, 192); // "Monthly hosting"
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Changed');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Monthly hosting (annual)');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo' }).click();

  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const doc = mupdf.Document.openDocument(
    readFileSync(await (await event).path()),
    'application/pdf',
  );
  expect(runs(doc).map((r) => r.text)).toContain('Monthly hosting');
});
