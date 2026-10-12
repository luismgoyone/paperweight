import { expect, type Page } from '@playwright/test';

export const FIXTURES = 'tests/fixtures';

export async function openApp(page: Page) {
  await page.goto('/#e2e');
  await expect(page.getByTestId('engine-ready')).toBeAttached({ timeout: 30_000 });
}

export async function openFixture(page: Page, name: string) {
  await page.getByTestId('file-input').setInputFiles(`${FIXTURES}/${name}`);
}

/** Sets 100% zoom so page points map 1:1 to CSS pixels. */
export async function zoom100(page: Page) {
  await page.getByLabel('Zoom', { exact: true }).selectOption('1');
}

/** Converts a point in PDF page space (pt) on page `n` (1-based) to viewport coordinates. */
export async function pagePoint(page: Page, n: number, x: number, y: number) {
  const box = (await page.locator(`[data-page="${n}"]`).boundingBox())!;
  const width = await page.locator(`[data-page="${n}"]`).evaluate((el) => el.clientWidth);
  const scale = box.width / width; // 1 unless CSS transforms are involved
  const zoom = width / 612;
  return { x: box.x + x * zoom * scale, y: box.y + y * zoom * scale };
}

export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { shift?: boolean } = {},
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (opts.shift) await page.keyboard.down('Shift');
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
  }
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
}
