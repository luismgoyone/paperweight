import { expect, type Page } from '@playwright/test';

export const FIXTURES = 'tests/fixtures';

export async function openApp(page: Page) {
  await page.goto('/#e2e');
  await expect(page.getByTestId('engine-ready')).toBeAttached({ timeout: 30_000 });
}

export async function openFixture(page: Page, name: string) {
  await page.getByTestId('file-input').setInputFiles(`${FIXTURES}/${name}`);
}
