import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { openApp, openFixture } from './helpers';

test('exports the invoice to Word with its text and table (spec §6 Phase 8)', async ({
  page,
  context,
  baseURL,
}) => {
  const appOrigin = new URL(baseURL!).origin;
  await openApp(page);
  await openFixture(page, 'invoice.pdf');
  await expect(page.getByTestId('page')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  const requests: string[] = [];
  context.on('request', (r) => requests.push(r.url()));

  await page.getByRole('button', { name: 'More download options' }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /Export to Word/ }).click();
  const download = await event;
  expect(download.suggestedFilename()).toBe('invoice.docx');

  const zip = await JSZip.loadAsync(readFileSync(await download.path()));
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('INVOICE');
  expect(xml).toContain('<w:tbl>');
  expect(xml).toContain('Monthly hosting');

  // Nothing but the app's own lazily loaded code was fetched; the document stayed local.
  for (const url of requests.filter((u) => !u.startsWith('blob:') && !u.startsWith('data:'))) {
    expect(url.startsWith(`${appOrigin}/assets/`), url).toBe(true);
  }
});
