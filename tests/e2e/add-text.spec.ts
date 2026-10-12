import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import * as mupdf from 'mupdf';
import { openApp, openFixture, pagePoint, zoom100 } from './helpers';

function runs(doc: mupdf.Document) {
  const out: { text: string; x0: number; x1: number; font: string; size: number }[] = [];
  let line: { c: string; quad: number[]; font: string; size: number }[] = [];
  doc
    .loadPage(0)
    .toStructuredText('preserve-whitespace')
    .walk({
      onChar(c, _o, font, size, quad) {
        line.push({ c, quad, font: font.getName(), size });
      },
      endLine() {
        const t = line
          .map((l) => l.c)
          .join('')
          .trim();
        if (t) {
          out.push({
            text: t,
            x0: Math.min(...line.map((l) => l.quad[0]!)),
            x1: Math.max(...line.map((l) => l.quad[2]!)),
            font: line[0]!.font,
            size: line[0]!.size,
          });
        }
        line = [];
      },
    });
  return out;
}

test('new text matches nearby text and snaps to the amount column (success criteria 2)', async ({
  page,
}) => {
  await openApp(page);
  await expect(page.getByTestId('fonts-ready')).toBeAttached();
  await openFixture(page, 'invoice.pdf');
  await expect(page.locator('[data-page="1"] canvas[data-rendered]')).toBeAttached();
  await zoom100(page);

  // Add "$31" a bit left of the amounts column, under the last row (baseline ~232).
  await page.getByRole('button', { name: 'Add text' }).click();
  const at = await pagePoint(page, 1, 480, 300);
  await page.mouse.click(at.x, at.y);
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeFocused();
  // Defaults come from the nearest run: Helvetica 10 -> Liberation Sans 10.
  await expect(page.getByLabel('Font', { exact: true })).toHaveValue('Liberation Sans');
  await expect(page.getByLabel('Font size')).toHaveValue('10');
  await page.keyboard.type('$31');
  await page.getByRole('button', { name: 'Align right' }).click();
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(editor).toBeHidden();

  // Drag it so its right edge lands 1.5 pt short of the column edge (540); it should snap.
  await page.getByRole('button', { name: 'Select' }).click();
  const sel = (await page.getByTestId('selection').boundingBox())!;
  const pageBox = (await page.locator('[data-page="1"]').boundingBox())!;
  const right = sel.x + sel.width - 3 - pageBox.x; // selection outline is padded by 3 px
  const from = { x: sel.x + sel.width / 2, y: sel.y + sel.height / 2 };
  const to = { x: from.x + (540 - 1.5 - right), y: from.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y);
  await expect(page.getByTestId('guide').first()).toBeAttached();
  await page.mouse.up();

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const doc = mupdf.Document.openDocument(
    readFileSync(await (await downloadEvent).path()),
    'application/pdf',
  );
  const all = runs(doc);
  const added = all.find((r) => r.text === '$31')!;
  const column = all.filter((r) => r.text === '$26').sort((a, b) => b.x1 - a.x1)[0]!;
  expect(added).toBeDefined();
  expect(Math.abs(added.x1 - column.x1)).toBeLessThan(0.5);
  expect(added.font).toMatch(/LiberationSans/);
  expect(added.size).toBeCloseTo(10, 1);
});

test('added text can be edited and deleted', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('fonts-ready')).toBeAttached();
  await openFixture(page, 'invoice.pdf');
  await zoom100(page);
  await page.getByRole('button', { name: 'Add text' }).click();
  const at = await pagePoint(page, 1, 100, 400);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type('Paid');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('text-editor')).toBeHidden();
  // Escape on new text cancels it.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  await page.mouse.click(at.x, at.y);
  await page.keyboard.type('Paid');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  // Re-open (click with the text tool), change it.
  await page.mouse.click(at.x + 5, at.y - 3);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Paid in full');
  await page.keyboard.press('ControlOrMeta+Enter');

  await page.getByRole('button', { name: 'Select' }).click();
  await page.mouse.click(at.x + 5, at.y - 3);
  await expect(page.getByTestId('selection')).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const doc = mupdf.Document.openDocument(
    readFileSync(await (await downloadEvent).path()),
    'application/pdf',
  );
  expect(runs(doc).map((r) => r.text)).toContain('Paid in full');

  await page.keyboard.press('Delete');
  const second = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const doc2 = mupdf.Document.openDocument(
    readFileSync(await (await second).path()),
    'application/pdf',
  );
  expect(runs(doc2).map((r) => r.text)).not.toContain('Paid in full');
});
