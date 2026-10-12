import { expect, test } from '@playwright/test';
import { openApp, openFixture } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openFixture(page, '100-pages.pdf');
  await expect(page.getByTestId('page')).toHaveCount(100);
});

test('only renders visible pages ±1', async ({ page }) => {
  await expect(page.locator('[data-testid=page] canvas[data-rendered]').first()).toBeAttached();
  expect(await page.locator('[data-testid=page] canvas').count()).toBeLessThanOrEqual(5);

  await page.getByTestId('viewer').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(page.locator('[data-page="100"] canvas[data-rendered]')).toBeAttached();
  expect(await page.locator('[data-testid=page] canvas').count()).toBeLessThanOrEqual(5);
  await expect(page.getByLabel('Current page')).toHaveValue('100');
});

test('zooms to a preset and to fit width', async ({ page }) => {
  await page.getByLabel('Zoom', { exact: true }).selectOption('2');
  await expect
    .poll(async () => (await page.locator('[data-page="1"]').boundingBox())?.width)
    .toBeCloseTo(1224, 0);

  await page.getByLabel('Zoom', { exact: true }).selectOption('fit-width');
  const viewerWidth = await page.getByTestId('viewer').evaluate((el) => el.clientWidth);
  await expect
    .poll(async () => (await page.locator('[data-page="1"]').boundingBox())?.width)
    .toBeCloseTo(Math.min(viewerWidth - 48, 612 * 4), -1);

  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(page.getByLabel('Zoom', { exact: true })).not.toHaveValue('fit-width');
});

test('searches and cycles through highlighted results', async ({ page }) => {
  const search = page.getByLabel('Search');
  await search.fill('invoice');
  await search.press('Enter');
  await expect(page.getByTestId('search-summary')).toHaveText('1 of 10');
  await expect(page.locator('[data-testid=hit][data-active]')).toBeVisible();
  await expect(page.getByLabel('Current page')).toHaveValue('10');

  await search.press('Enter');
  await expect(page.getByTestId('search-summary')).toHaveText('2 of 10');
  await expect(page.getByLabel('Current page')).toHaveValue('20');

  await search.press('Shift+Enter');
  await search.press('Shift+Enter');
  await expect(page.getByTestId('search-summary')).toHaveText('10 of 10');

  await search.fill('zzz');
  await search.press('Enter');
  await expect(page.getByTestId('search-summary')).toHaveText('No results');
  await expect(page.getByTestId('hit')).toHaveCount(0);
});

test('navigates with thumbnails and the page box', async ({ page }) => {
  await page.getByRole('button', { name: 'Go to page 3', exact: true }).click();
  await expect(page.getByLabel('Current page')).toHaveValue('3');
  await expect(page.locator('[data-page="3"] canvas[data-rendered]')).toBeAttached();

  const box = page.getByLabel('Current page');
  await box.fill('57');
  await box.press('Enter');
  await expect(box).toHaveValue('57');
  await expect(page.locator('[data-page="57"] canvas[data-rendered]')).toBeAttached();
});

test('scrolls 100 pages without long frames (smoke check)', async ({ page, browserName }) => {
  // A frame-timing smoke check: only meaningful on one engine without other tests competing
  // for the CPU; CI runs it on Chromium.
  test.skip(browserName !== 'chromium', 'frame timing is engine- and load-dependent');
  const worst = await page.getByTestId('viewer').evaluate(async (el) => {
    const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
    let worst = 0;
    let last = await frame();
    for (let i = 0; i < 40; i++) {
      el.scrollTop += el.scrollHeight / 40;
      const now = await frame();
      worst = Math.max(worst, now - last);
      last = now;
    }
    return worst;
  });
  expect(worst).toBeLessThan(100);
});

test('keeps the same page in view when zooming deep into the document', async ({ page }) => {
  const box = page.getByLabel('Current page');
  await box.fill('80');
  await box.press('Enter');
  await expect(box).toHaveValue('80');
  await page.getByLabel('Zoom', { exact: true }).selectOption('1');
  await expect(box).toHaveValue('80');
  await page.getByLabel('Zoom', { exact: true }).selectOption('2');
  await expect(box).toHaveValue('80');
  await page.getByLabel('Zoom', { exact: true }).selectOption('0.5');
  await expect(box).toHaveValue('80');
});
