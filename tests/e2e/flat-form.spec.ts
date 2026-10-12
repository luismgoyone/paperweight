import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import * as mupdf from 'mupdf';
import { openApp, openFixture, pagePoint, zoom100 } from './helpers';

// flat-form.pdf: a Word-style form without fields. The Name box is x 200–560, y 100–122;
// the "Yes" checkbox is the 12 pt square at x 70, y 151.

async function openFlatForm(page: import('@playwright/test').Page, name = 'flat-form.pdf') {
  await openApp(page);
  await expect(page.getByTestId('fonts-ready')).toBeAttached();
  await openFixture(page, name);
  await expect(page.locator('[data-page="1"] canvas[data-rendered]')).toBeAttached();
  await zoom100(page);
  await page.getByRole('button', { name: 'Form fill' }).click();
  // Detection has finished once the banner says what it found.
  await expect(page.getByRole('note')).not.toContainText('Looking for boxes');
}

function words(doc: mupdf.Document) {
  const out: { text: string; x: number; y: number }[] = [];
  doc
    .loadPage(0)
    .toStructuredText('')
    .walk({
      onChar(c, _o, _f, _s, q) {
        out.push({ text: c, x: (q[0] + q[2]) / 2, y: (q[1] + q[5]) / 2 });
      },
    });
  return out;
}

test('click a detected box on a flat form and type into it', async ({ page }) => {
  await openFlatForm(page);
  await expect(page.getByRole('note')).toContainText(
    'No fillable fields in this PDF. Click a highlighted box to type in it.',
  );
  await expect(page.getByTestId('slot')).toHaveCount(5); // Name, TIN, 3 checkboxes
  // Each box has its own name for screen readers.
  await expect(page.getByRole('button', { name: 'Checkbox 1 of 3' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Text box 1 of 2' })).toBeVisible();

  const at = await pagePoint(page, 1, 380, 111);
  await page.mouse.click(at.x, at.y);
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeVisible();
  const box = (await editor.boundingBox())!;
  const origin = await pagePoint(page, 1, 200, 100);
  expect(box.x).toBeGreaterThanOrEqual(origin.x);
  expect(box.y).toBeGreaterThanOrEqual(origin.y);
  expect(box.y + box.height).toBeLessThanOrEqual(origin.y + 22);
  await page.keyboard.type('JUAN DELA CRUZ');
  await page.keyboard.press('Enter');
  await expect(editor).toBeHidden();

  // The box stays clickable once filled, and clicking it again edits that text (no second
  // copy on top).
  await expect(page.getByTestId('slot')).toHaveCount(5);
  await page.mouse.click(at.x, at.y);
  await expect(editor).toHaveValue('JUAN DELA CRUZ');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('JUAN DELA CRUZ');
  await page.keyboard.press('Enter');
  await expect(editor).toBeHidden();

  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const doc = mupdf.Document.openDocument(
    readFileSync(await (await event).path()),
    'application/pdf',
  );
  // Everything printed between the Name box's top and bottom edges, right of its label.
  const typed = words(doc).filter((w) => w.text.trim() && w.x > 200 && w.y > 95 && w.y < 127);
  expect(typed.map((w) => w.text).join('')).toBe('JUANDELACRUZ');
  for (const w of typed) {
    expect(w.x).toBeLessThan(560);
    expect(w.y).toBeGreaterThan(100);
    expect(w.y).toBeLessThan(122);
  }
});

test('click a detected checkbox to tick it, again to clear it', async ({ page }) => {
  await openFlatForm(page);
  // The "Yes" checkbox, found by position rather than by detection order.
  const at = await pagePoint(page, 1, 76, 157);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await page.mouse.click(at.x, at.y);

  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  let doc = mupdf.Document.openDocument(
    readFileSync(await (await event).path()),
    'application/pdf',
  );
  const x = words(doc).find((w) => w.text === 'X')!;
  expect(x).toBeDefined();
  expect(Math.abs(x.x - 76)).toBeLessThan(2);
  expect(Math.abs(x.y - 157)).toBeLessThan(3);

  await page.mouse.click(at.x, at.y);
  const again = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  doc = mupdf.Document.openDocument(readFileSync(await (await again).path()), 'application/pdf');
  expect(words(doc).some((w) => w.text === 'X')).toBe(false);
});

test('a page without boxes says so and points to Add text', async ({ page }) => {
  await openFlatForm(page, 'simple.pdf');
  await expect(page.getByRole('note')).toContainText('No boxes were found on this page');
  await expect(page.getByRole('note')).toContainText('Add text (T)');
  await expect(page.getByTestId('slot')).toHaveCount(0);
});
