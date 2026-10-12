import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { drag, openApp, openFixture, pagePoint, zoom100 } from './helpers';

async function download(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  return mupdf.Document.openDocument(readFileSync(await (await event).path()), 'application/pdf');
}

/** Bounding boxes of images on page 1 of a document. */
function images(doc: mupdf.Document) {
  const boxes: number[][] = [];
  doc
    .loadPage(0)
    .toStructuredText('preserve-images')
    .walk({ onImageBlock: (bbox) => void boxes.push(bbox.map(Math.round)) });
  return boxes;
}

/** A white 400×200 PNG with a black bar in the middle, like a photographed signature. */
function photoPng(): Buffer {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 400, 200], false);
  const px = pix.getPixels();
  for (let i = 0; i < px.length; i += 3) px[i] = px[i + 1] = px[i + 2] = 250;
  for (let y = 90; y < 110; y++)
    for (let x = 50; x < 350; x++) px.fill(20, (y * 400 + x) * 3, (y * 400 + x) * 3 + 3);
  return Buffer.from(pix.asPNG());
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('fonts-ready')).toBeAttached();
  await openFixture(page, 'invoice.pdf');
  await expect(page.locator('[data-page="1"] canvas[data-rendered]')).toBeAttached();
  await zoom100(page);
});

test('draw a signature and place it on the page', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add signature' });
  await expect(dialog).toBeVisible();
  const pad = (await page.getByTestId('signature-pad').boundingBox())!;
  await drag(page, { x: pad.x + 60, y: pad.y + 120 }, { x: pad.x + 300, y: pad.y + 80 });
  await drag(page, { x: pad.x + 300, y: pad.y + 80 }, { x: pad.x + 420, y: pad.y + 130 });
  await dialog.getByRole('button', { name: 'Use signature' }).click();
  await expect(dialog).toBeHidden();

  const at = await pagePoint(page, 1, 450, 600);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  const [box] = images(await download(page));
  expect(box).toBeDefined();
  const [x0, y0, x1, y1] = box!;
  expect(x1! - x0!).toBe(150); // default signature width
  expect((x0! + x1!) / 2).toBeCloseTo(450, 0);
  expect((y0! + y1!) / 2).toBeCloseTo(600, 0);
});

test('type a signature; it can be placed twice from the session list', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add signature' });
  await dialog.getByRole('tab', { name: 'Type' }).click();
  await dialog.getByLabel('Your name').fill('Ada Lovelace');
  await dialog.getByRole('radio', { name: 'Ada Lovelace' }).nth(1).click();
  await dialog.getByRole('button', { name: 'Use signature' }).click();
  for (const y of [450, 560]) {
    const at = await pagePoint(page, 1, 300, y);
    await page.mouse.click(at.x, at.y);
  }
  await expect(page.getByRole('button', { name: 'Signature 1' })).toBeVisible();
  expect(images(await download(page))).toHaveLength(2);
});

test('upload a photographed signature with background removal', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add signature' });
  await dialog.getByRole('tab', { name: 'Upload' }).click();
  await dialog
    .getByLabel('Signature image')
    .setInputFiles({ name: 'sig.png', mimeType: 'image/png', buffer: photoPng() });
  await expect(dialog.getByTestId('upload-preview')).toHaveAttribute('width', '400');
  await dialog.getByRole('button', { name: 'Use signature' }).click();
  const at = await pagePoint(page, 1, 300, 600);
  await page.mouse.click(at.x, at.y);

  const doc = await download(page);
  const [box] = images(doc);
  // Trimmed to the dark bar (300×20 px + padding), so it's much wider than tall.
  expect((box![2]! - box![0]!) / (box![3]! - box![1]!)).toBeGreaterThan(8);
});

test('insert an image, resize it from a corner, and delete it', async ({ page }) => {
  await page
    .getByTestId('image-input')
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: photoPng() });
  const at = await pagePoint(page, 1, 300, 350);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('handle-se')).toBeVisible();

  const [first] = images(await download(page));
  const width = first![2]! - first![0]!;
  expect(width).toBe(300); // 400 px * 0.75, capped at 300 pt

  const se = (await page.getByTestId('handle-se').boundingBox())!;
  const grab = { x: se.x + se.width / 2, y: se.y + se.height / 2 };
  await drag(page, grab, { x: grab.x - 100, y: grab.y - 50 });
  const [resized] = images(await download(page));
  expect(resized![2]! - resized![0]!).toBe(200);
  expect(resized![0]).toBe(first![0]); // top-left stays put
  expect((resized![3]! - resized![1]!) / (resized![2]! - resized![0]!)).toBeCloseTo(0.5, 1);

  await page.keyboard.press('Delete');
  expect(images(await download(page))).toHaveLength(0);
});
