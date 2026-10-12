import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { openApp, openFixture } from './helpers';

const titles = (doc: mupdf.Document) =>
  Array.from({ length: doc.countPages() }, (_, i) =>
    doc.loadPage(i).toStructuredText('').asText().split('\n')[0]!.trim(),
  );

async function downloads(page: Page, count: number, trigger: () => Promise<void>) {
  const files: { name: string; doc: mupdf.Document }[] = [];
  const done = new Promise<void>((resolve) => {
    page.on('download', async (d) => {
      files.push({
        name: d.suggestedFilename(),
        doc: mupdf.Document.openDocument(readFileSync(await d.path()), 'application/pdf'),
      });
      if (files.length === count) resolve();
    });
  });
  await trigger();
  await done;
  return files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

async function current(page: Page) {
  const [file] = await downloads(page, 1, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  return file!.doc;
}

const thumb = (page: Page, n: number) =>
  page.getByRole('button', { name: `Go to page ${n}`, exact: true });

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'simple.pdf');
  await expect(page.getByTestId('thumbnail')).toHaveCount(3);
});

test('reorders pages by dragging a thumbnail', async ({ page }) => {
  const from = (await thumb(page, 3).boundingBox())!;
  const to = (await thumb(page, 1).boundingBox())!;
  // Grab near the top: the thumbnail may extend below the viewport.
  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + 10, { steps: 8 });
  await expect(page.getByTestId('drop-line')).toBeVisible();
  await page.mouse.up();
  expect(titles(await current(page))).toEqual(['Page 3', 'Page 1', 'Page 2']);

  await page.getByRole('button', { name: 'Undo' }).click();
  expect(titles(await current(page))).toEqual(['Page 1', 'Page 2', 'Page 3']);
});

test('moves selected pages with Alt+arrows', async ({ page }) => {
  await thumb(page, 1).click();
  await page.keyboard.press('Alt+ArrowDown');
  expect(titles(await current(page))).toEqual(['Page 2', 'Page 1', 'Page 3']);
});

test('rotates, deletes with undo, and inserts a blank page', async ({ page }) => {
  await thumb(page, 2).click();
  await page.getByRole('button', { name: 'Rotate right' }).click();
  let doc = (await current(page)) as mupdf.PDFDocument;
  expect(doc.findPage(1).get('Rotate').asNumber()).toBe(90);

  await thumb(page, 1).click();
  await thumb(page, 3).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Delete pages' }).click();
  await expect(page.getByTestId('thumbnail')).toHaveCount(1);
  doc = (await current(page)) as mupdf.PDFDocument;
  expect(titles(doc)).toEqual(['Page 2']);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('thumbnail')).toHaveCount(3);

  await thumb(page, 1).click();
  await page.getByRole('button', { name: 'Insert blank page' }).click();
  await expect(page.getByTestId('thumbnail')).toHaveCount(4);
  expect(titles(await current(page))).toEqual(['Page 1', '', 'Page 2', 'Page 3']);
});

test('inserts pages from another PDF, including a password-protected one', async ({ page }) => {
  await thumb(page, 3).click();
  await page.getByTestId('insert-pdf-input').setInputFiles('tests/fixtures/invoice.pdf');
  await expect(page.getByTestId('thumbnail')).toHaveCount(4);

  await page.getByTestId('insert-pdf-input').setInputFiles('tests/fixtures/encrypted.pdf');
  const dialog = page.getByRole('dialog', { name: 'Password required' });
  await dialog.getByLabel('Password').fill('secret');
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('thumbnail')).toHaveCount(7);
  // Page 3 is still selected, so both inserts land right after it (the latest first).
  expect(titles(await current(page))).toEqual([
    'Page 1',
    'Page 2',
    'Page 3',
    'Page 1',
    'Page 2',
    'Page 3',
    'INVOICE',
  ]);
});

test('extracts selected pages and splits the document', async ({ page }) => {
  await thumb(page, 2).click();
  await thumb(page, 3).click({ modifiers: ['Shift'] });
  const [extracted] = await downloads(page, 1, () =>
    page.getByRole('button', { name: 'Extract pages' }).click(),
  );
  expect(extracted!.name).toBe('simple-pages-2-3.pdf');
  expect(titles(extracted!.doc)).toEqual(['Page 2', 'Page 3']);

  await page.getByRole('button', { name: 'Split document' }).click();
  const dialog = page.getByRole('dialog', { name: 'Split document' });
  await dialog.getByLabel('Page ranges').fill('1, 2-3');
  await expect(dialog.getByText('2 files')).toBeVisible();
  const parts = await downloads(page, 2, () =>
    dialog.getByRole('button', { name: 'Split and download' }).click(),
  );
  expect(parts.map((p) => p.name)).toEqual(['simple-pages-1-1.pdf', 'simple-pages-2-3.pdf']);
  expect(parts.map((p) => titles(p.doc))).toEqual([['Page 1'], ['Page 2', 'Page 3']]);
});
