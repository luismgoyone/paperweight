import { expect, test } from '@playwright/test';
import { openApp, openFixture } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'simple.pdf');
  await expect(page.locator('[data-page="1"] canvas[data-rendered]')).toBeAttached();
});

test('tools show a tooltip with their name, shortcut and a hint on hover', async ({ page }) => {
  const tooltip = page.getByRole('tooltip');
  await page.getByRole('button', { name: 'Highlight' }).hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Highlight');
  await expect(tooltip).toContainText('H');
  await expect(tooltip).toContainText('Drag across text');
  // It sits below the button, inside the window.
  const button = (await page.getByRole('button', { name: 'Highlight' }).boundingBox())!;
  const tip = (await tooltip.boundingBox())!;
  expect(tip.y).toBeGreaterThanOrEqual(button.y + button.height);
  expect(tip.x).toBeGreaterThanOrEqual(0);

  // Moving to another tool switches the tooltip; leaving the toolbar hides it.
  await page.getByRole('button', { name: 'Pen' }).hover();
  await expect(tooltip).toContainText('Pen');
  await expect(tooltip).not.toContainText('Highlight');
  await page.mouse.move(600, 500);
  await expect(tooltip).toBeHidden();
});

test('tooltips also appear on keyboard focus and are described to screen readers', async ({
  page,
}) => {
  // A key press first, so the focus counts as keyboard focus (:focus-visible). Tab itself
  // skips buttons in WebKit by default, as in Safari.
  await page.keyboard.press('Shift');
  await page.getByRole('button', { name: 'Edit text' }).focus();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('Edit text');
  await expect(page.getByRole('button', { name: 'Edit text' })).toHaveAttribute(
    'aria-describedby',
    (await tooltip.getAttribute('id'))!,
  );
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
});
