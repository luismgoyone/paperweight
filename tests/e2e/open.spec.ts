import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { FIXTURES, openApp, openFixture } from './helpers';

test.beforeEach(async ({ page }) => openApp(page));

test('shows the empty state with privacy messaging', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Open PDF' })).toBeVisible();
  await expect(page.getByText('Files never leave your device')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Source code' })).toBeVisible();
});

test('opens a PDF from the file picker', async ({ page }) => {
  await openFixture(page, 'simple.pdf');
  await expect(page.getByTestId('file-name')).toHaveText('simple.pdf');
  await expect(page.getByTestId('page')).toHaveCount(3);
  await expect(page.getByTestId('page').first().locator('canvas')).toBeVisible();
});

test('prompts for a password and retries after a wrong one', async ({ page }) => {
  await openFixture(page, 'encrypted.pdf');
  const dialog = page.getByRole('dialog', { name: 'Password required' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password').fill('bad');
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(dialog.getByText('Wrong password')).toBeVisible();
  await dialog.getByLabel('Password').fill('secret');
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('page')).toHaveCount(3);
});

test('reports a corrupt file and stays usable', async ({ page }) => {
  await openFixture(page, 'corrupt.pdf');
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  await openFixture(page, 'simple.pdf');
  await expect(page.getByTestId('page')).toHaveCount(3);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('opens a PDF dropped onto the window', async ({ page }) => {
  const bytes = [...readFileSync(`${FIXTURES}/simple.pdf`)];
  const dataTransfer = await page.evaluateHandle((data) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(data)], 'dropped.pdf', { type: 'application/pdf' }));
    return dt;
  }, bytes);
  await page.dispatchEvent('[data-testid=drop-zone]', 'drop', { dataTransfer });
  await expect(page.getByTestId('file-name')).toHaveText('dropped.pdf');
  await expect(page.getByTestId('page')).toHaveCount(3);
});
