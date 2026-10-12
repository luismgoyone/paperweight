import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { drag, openApp, openFixture, pagePoint, zoom100 } from './helpers';

async function downloadPdf(page: Page, flatten = false) {
  const downloadEvent = page.waitForEvent('download');
  if (flatten) {
    await page.getByRole('button', { name: 'More download options' }).click();
    await page.getByRole('menuitem', { name: /Download flattened/ }).click();
  } else {
    await page.getByRole('button', { name: 'Download PDF' }).click();
  }
  const download = await downloadEvent;
  return new mupdf.PDFDocument(readFileSync(await download.path()));
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'invoice.pdf');
  await expect(page.locator('[data-page="1"] canvas[data-rendered]')).toBeAttached();
  await zoom100(page);
});

test('highlights selected text as a real PDF annotation', async ({ page }) => {
  await page.getByRole('button', { name: 'Highlight' }).click();
  // "Monthly hosting" sits at x 72..145, baseline 196.
  await drag(page, await pagePoint(page, 1, 70, 192), await pagePoint(page, 1, 150, 192));
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  const doc = await downloadPdf(page);
  const [annot, ...rest] = doc.loadPage(0).getAnnotations();
  expect(rest).toHaveLength(0);
  expect(annot!.getType()).toBe('Highlight');
  const xs = annot!.getQuadPoints().flatMap((q) => [q[0], q[2], q[4], q[6]]);
  expect(Math.min(...xs)).toBeLessThan(75);
  expect(Math.max(...xs)).toBeGreaterThan(140);
});

test('draws, recolors, moves, deletes and undoes a rectangle', async ({ page }) => {
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await drag(page, await pagePoint(page, 1, 100, 300), await pagePoint(page, 1, 200, 360));

  // Select it, recolor via the properties panel.
  await page.getByRole('button', { name: 'Select' }).click();
  await page.mouse.click(
    ...(Object.values(await pagePoint(page, 1, 150, 300)) as [number, number]),
  );
  await expect(page.getByTestId('selection')).toBeVisible();
  await page
    .getByRole('group', { name: 'Stroke color' })
    .getByRole('button', { name: 'Blue' })
    .click();

  // Move it by 50 pt to the right (Alt disables snapping).
  await page.keyboard.down('Alt');
  await drag(page, await pagePoint(page, 1, 150, 300), await pagePoint(page, 1, 200, 300));
  await page.keyboard.up('Alt');

  let doc = await downloadPdf(page);
  let [annot] = doc.loadPage(0).getAnnotations();
  expect(annot!.getType()).toBe('Square');
  expect(annot!.getColor().map((c) => Math.round(c * 100) / 100)).toEqual([0.15, 0.39, 0.92]);
  expect(Math.round(annot!.getRect()[0])).toBe(150);

  await page.keyboard.press('Delete');
  doc = await downloadPdf(page);
  expect(doc.loadPage(0).getAnnotations()).toHaveLength(0);

  await page.keyboard.press('ControlOrMeta+z');
  doc = await downloadPdf(page);
  [annot] = doc.loadPage(0).getAnnotations();
  expect(annot!.getType()).toBe('Square');
});

test('pen strokes and notes', async ({ page }) => {
  await page.getByRole('button', { name: 'Pen' }).click();
  await drag(page, await pagePoint(page, 1, 100, 400), await pagePoint(page, 1, 250, 450));
  await page.getByRole('button', { name: 'Note' }).click();
  const at = await pagePoint(page, 1, 400, 420);
  await page.mouse.click(at.x, at.y);
  await page.getByLabel('Note text').fill('Check this line');
  await page.getByLabel('Note text').blur();

  const doc = await downloadPdf(page);
  const annots = doc.loadPage(0).getAnnotations();
  expect(annots.map((a) => a.getType()).sort()).toEqual(['Ink', 'Text']);
  expect(annots.find((a) => a.getType() === 'Text')!.getContents()).toBe('Check this line');
});

test('downloads a flattened copy with no annotations', async ({ page }) => {
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await drag(page, await pagePoint(page, 1, 100, 300), await pagePoint(page, 1, 200, 360));
  const doc = await downloadPdf(page, true);
  expect(doc.loadPage(0).getAnnotations()).toHaveLength(0);
});
