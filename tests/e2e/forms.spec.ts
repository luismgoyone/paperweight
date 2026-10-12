import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { openApp, openFixture, zoom100 } from './helpers';

async function download(page: Page, flattenForms = false) {
  const event = page.waitForEvent('download');
  if (flattenForms) {
    await page.getByRole('button', { name: 'More download options' }).click();
    await page.getByRole('menuitem', { name: /form flattened/ }).click();
  } else {
    await page.getByRole('button', { name: 'Download PDF' }).click();
  }
  return new mupdf.PDFDocument(readFileSync(await (await event).path()));
}

const values = (doc: mupdf.PDFDocument) =>
  Object.fromEntries(
    doc
      .loadPage(0)
      .getWidgets()
      .filter((w) => w.getName() !== '' && (!w.isRadioButton() || w.getValue() !== 'Off'))
      .map((w) => [w.getName(), w.getValue()]),
  );

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'form.pdf');
  await expect(page.locator('[data-page="1"] canvas[data-rendered]')).toBeAttached();
  await zoom100(page);
});

test('fills every field type with keyboard tab order', async ({ page }) => {
  await expect(page.getByRole('note')).toContainText('fillable fields');
  await page.getByRole('button', { name: 'Fill form' }).click();
  await expect(page.getByLabel('name', { exact: true })).toBeVisible();

  await page.getByLabel('name', { exact: true }).fill('Ada Lovelace');
  await page.keyboard.press('Tab'); // -> notes (document order)
  await expect(page.getByLabel('notes')).toBeFocused();
  await page.keyboard.type('First line');
  await page.keyboard.press('Tab'); // account is read-only and skipped
  await expect(page.getByLabel('account')).toBeDisabled();
  await expect(page.getByLabel('dates.signed')).toBeFocused();
  await page.keyboard.type('2026-10-12');
  await page.keyboard.press('Tab');

  await page.getByLabel('subscribe').check();
  await page.getByLabel('plan: pro').check();
  await page.getByLabel('plan: team').check();
  await page.getByLabel('country').selectOption('Mexico');

  const doc = await download(page);
  expect(values(doc)).toEqual({
    name: 'Ada Lovelace',
    notes: 'First line',
    account: 'ACCT-001',
    'dates.signed': '2026-10-12',
    subscribe: 'Yes',
    plan: 'team',
    country: 'Mexico',
    size: 'S',
  });
});

test('downloads with the form flattened', async ({ page }) => {
  await page.getByRole('button', { name: 'Fill form' }).click();
  await page.getByLabel('name', { exact: true }).fill('Flat Name');
  await page.getByLabel('name', { exact: true }).blur();
  const doc = await download(page, true);
  expect(doc.loadPage(0).getWidgets()).toHaveLength(0);
  expect(doc.loadPage(0).toStructuredText('').asText()).toContain('Flat Name');
});

test('undo reverts a field', async ({ page }) => {
  await page.getByRole('button', { name: 'Fill form' }).click();
  await page.getByLabel('subscribe').check();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('subscribe')).not.toBeChecked();
  expect(values(await download(page)).subscribe).toBe('Off');
});

test('⌘S saves a value that is still being typed', async ({ page }) => {
  await page.getByRole('button', { name: 'Fill form' }).click();
  await page.getByLabel('name', { exact: true }).fill('Typed then saved');
  const event = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+s');
  const doc = new mupdf.PDFDocument(readFileSync(await (await event).path()));
  expect(values(doc).name).toBe('Typed then saved');
});

test('dropdowns store the export value and show the label', async ({ page }) => {
  await page.getByRole('button', { name: 'Fill form' }).click();
  const size = page.getByLabel('size');
  await expect(size).toHaveValue('S');
  await expect(size.locator('option:checked')).toHaveText('Small');
  await size.selectOption({ label: 'Medium' });
  expect(values(await download(page)).size).toBe('M');
});
