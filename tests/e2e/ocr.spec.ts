import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import * as mupdf from 'mupdf';
import { openApp, openFixture } from './helpers';

test('recognises a scanned page so it can be searched (spec §6 Phase 7)', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const appOrigin = new URL(baseURL!).origin;
  const requests: { url: string; method: string }[] = [];
  await openApp(page);
  await expect(page.getByTestId('fonts-ready')).toBeAttached();
  await page.waitForLoadState('networkidle');
  context.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));

  await openFixture(page, 'scanned.pdf');
  await expect(page.getByText('This page has no text')).toBeVisible();
  await page.getByRole('button', { name: 'Recognize text (OCR)' }).click();
  await expect(page.getByRole('status')).toContainText('Text recognised', { timeout: 90_000 });

  await page.getByLabel('Search').fill('invoice');
  await page.getByLabel('Search').press('Enter');
  await expect(page.getByTestId('search-summary')).toHaveText('1 of 1');

  // Privacy: OCR only fetched its own engine and language data, from this site, with GETs.
  const network = requests.filter((r) => !r.url.startsWith('blob:') && !r.url.startsWith('data:'));
  for (const r of network) {
    expect(r.url.startsWith(appOrigin), r.url).toBe(true);
    expect(r.method).toBe('GET');
    expect(new URL(r.url).pathname, r.url).toMatch(/^\/(ocr|tessdata|assets)\//);
  }
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);

  // The downloaded PDF carries the (invisible) text layer.
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const doc = mupdf.Document.openDocument(
    readFileSync(await (await event).path()),
    'application/pdf',
  );
  expect(doc.loadPage(0).toStructuredText('').asText().toLowerCase()).toContain('invoice');
});
