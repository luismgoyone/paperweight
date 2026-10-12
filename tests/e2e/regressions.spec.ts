import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { drag, openApp, openFixture, pagePoint, zoom100 } from './helpers';

async function download(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  return new mupdf.PDFDocument(readFileSync(await (await event).path()));
}

const pageText = (doc: mupdf.PDFDocument) => doc.loadPage(0).toStructuredText('').asText();

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('fonts-ready')).toBeAttached();
  await openFixture(page, 'invoice.pdf');
  await expect(page.locator('[data-page="1"] canvas[data-rendered]')).toBeAttached();
  await zoom100(page);
});

test('Esc while editing existing text keeps the committed text', async ({ page }) => {
  await page.getByRole('button', { name: 'Add text' }).click();
  const at = await pagePoint(page, 1, 100, 450);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type('Original');
  await page.keyboard.press('ControlOrMeta+Enter');

  await page.mouse.click(at.x + 5, at.y - 3); // reopen with the text tool
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Changed');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('text-editor')).toBeHidden();

  const text = pageText(await download(page));
  expect(text).toContain('Original');
  expect(text).not.toContain('Changed');
  // Undo history: just the add.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('note text survives a following color change', async ({ page }) => {
  await page.getByRole('button', { name: 'Note' }).click();
  const at = await pagePoint(page, 1, 400, 450);
  await page.mouse.click(at.x, at.y);
  await page.getByLabel('Note text').fill('Keep me');
  await page.getByRole('group', { name: 'Color' }).getByRole('button', { name: 'Green' }).click();
  const [note] = (await download(page)).loadPage(0).getAnnotations();
  expect(note!.getContents()).toBe('Keep me');
  expect(note!.getColor().map((c) => Math.round(c * 100) / 100)).toEqual([0.09, 0.64, 0.29]);
});

test('note text is kept when clicking elsewhere on the page', async ({ page }) => {
  await page.getByRole('button', { name: 'Note' }).click();
  const at = await pagePoint(page, 1, 400, 450);
  await page.mouse.click(at.x, at.y);
  await page.getByLabel('Note text').fill('Typed then clicked away');
  const away = await pagePoint(page, 1, 100, 650);
  await page.mouse.click(away.x, away.y);
  const [note] = (await download(page)).loadPage(0).getAnnotations();
  expect(note!.getContents()).toBe('Typed then clicked away');
});

test('holding an arrow key moves the selection in one undo step', async ({ page }) => {
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await drag(page, await pagePoint(page, 1, 100, 450), await pagePoint(page, 1, 200, 500));
  await page.getByRole('button', { name: 'Select' }).click();
  const inside = await pagePoint(page, 1, 150, 450);
  await page.mouse.click(inside.x, inside.y);
  await expect(page.getByTestId('selection')).toBeVisible();

  await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 9; i++) await page.keyboard.down('ArrowRight'); // auto-repeat
  await page.keyboard.up('ArrowRight');

  let [rect] = (await download(page)).loadPage(0).getAnnotations();
  expect(Math.round(rect!.getRect()[0])).toBe(110);
  await page.keyboard.press('ControlOrMeta+z');
  [rect] = (await download(page)).loadPage(0).getAnnotations();
  expect(Math.round(rect!.getRect()[0])).toBe(100);
});

test('Backspace in the font dropdown does not delete the selection', async ({ page }) => {
  await page.getByRole('button', { name: 'Add text' }).click();
  const at = await pagePoint(page, 1, 100, 450);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type('Stay');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByLabel('Font', { exact: true })).toBeVisible(); // selected text's panel
  await page.getByLabel('Font', { exact: true }).focus();
  await page.keyboard.press('Backspace');
  expect(pageText(await download(page))).toContain('Stay');
});
