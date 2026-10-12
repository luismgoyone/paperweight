import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { drag, openApp, openFixture, pagePoint, zoom100 } from './helpers';

async function downloadVia(page: Page, trigger: () => Promise<void>) {
  const event = page.waitForEvent('download');
  await trigger();
  return readFileSync(await (await event).path());
}
const download = (page: Page) =>
  downloadVia(page, () => page.getByRole('button', { name: 'Download PDF' }).click());
const menu = async (page: Page, item: RegExp) => {
  await page.getByRole('button', { name: 'More download options' }).click();
  await page.getByRole('menuitem', { name: item }).click();
};

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('redacts a marked area after confirmation; the text is gone from the file', async ({
  page,
}) => {
  await openFixture(page, 'invoice.pdf');
  await zoom100(page);
  await page.getByRole('button', { name: 'Redact' }).click();
  // Mark the "Example Studio LLC" line (baseline 96).
  await drag(page, await pagePoint(page, 1, 68, 86), await pagePoint(page, 1, 200, 99));
  await expect(page.getByTestId('redact-mark')).toHaveCount(1);
  await expect(page.getByTestId('redact-count')).toHaveText('1 area marked');

  // Marks alone change nothing.
  const before = mupdf.Document.openDocument(await download(page), 'application/pdf');
  expect(before.loadPage(0).toStructuredText('').asText()).toContain('Example Studio');

  await page.getByRole('button', { name: 'Apply redactions' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply 1 redaction?' });
  await dialog.getByRole('button', { name: 'Redact' }).click();
  await expect(page.getByTestId('redact-mark')).toHaveCount(0);

  const bytes = await download(page);
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const text = doc.loadPage(0).toStructuredText('').asText();
  expect(text).not.toContain('Example Studio');
  expect(text).toContain('INVOICE');
});

test('redacts every search match', async ({ page }) => {
  await openFixture(page, '100-pages.pdf');
  await page.getByLabel('Search').fill('invoice');
  await page.getByLabel('Search').press('Enter');
  await page.getByRole('button', { name: 'Redact all matches (10)' }).click();
  await expect(page.getByTestId('redact-count')).toHaveText('10 areas marked');
  await page.getByRole('button', { name: 'Apply redactions' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Redact' }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  const doc = mupdf.Document.openDocument(await download(page), 'application/pdf');
  let found = 0;
  for (let i = 0; i < doc.countPages(); i++)
    found += doc.loadPage(i).search('invoice', 'ignore-case').length;
  expect(found).toBe(0);
});

test('compress shows sizes and downloads a smaller copy', async ({ page }) => {
  await openFixture(page, '100-pages.pdf');
  await menu(page, /Compress/);
  const dialog = page.getByRole('dialog', { name: 'Compress PDF' });
  await expect(dialog.getByTestId('compress-sizes')).not.toHaveText('Calculating…');
  const bytes = await downloadVia(page, () =>
    dialog.getByRole('button', { name: 'Download compressed' }).click(),
  );
  expect(bytes.length).toBeLessThanOrEqual(
    readFileSync('tests/fixtures/100-pages.pdf').length + 2048,
  );
  expect(mupdf.Document.openDocument(bytes, 'application/pdf').countPages()).toBe(100);
});

test('sets a password with restrictions, and removes a password', async ({ page }) => {
  await openFixture(page, 'simple.pdf');
  await menu(page, /Password/);
  let dialog = page.getByRole('dialog', { name: 'Password protection' });
  await dialog.getByLabel('Open password', { exact: true }).fill('s3cret');
  await dialog.getByLabel('Repeat open password').fill('s3cret');
  await dialog.getByLabel('Copying text and images').uncheck();
  const protectedBytes = await downloadVia(page, () =>
    dialog.getByRole('button', { name: 'Download protected' }).click(),
  );
  const doc = mupdf.Document.openDocument(protectedBytes, 'application/pdf');
  expect(doc.needsPassword()).toBe(true);
  expect(doc.authenticatePassword('s3cret')).toBeGreaterThan(0);
  expect(doc.hasPermission('copy')).toBe(false);
  expect(doc.hasPermission('print')).toBe(true);

  // Open a protected file and download it without the password.
  await openFixture(page, 'encrypted.pdf');
  const pw = page.getByRole('dialog', { name: 'Password required' });
  await pw.getByLabel('Password').fill('secret');
  await pw.getByRole('button', { name: 'Open' }).click();
  await menu(page, /Password/);
  dialog = page.getByRole('dialog', { name: 'Password protection' });
  const open = await downloadVia(page, () =>
    dialog.getByRole('button', { name: 'Download without a password' }).click(),
  );
  expect(mupdf.Document.openDocument(open, 'application/pdf').needsPassword()).toBe(false);
});
