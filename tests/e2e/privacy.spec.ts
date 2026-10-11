import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';

// Spec §8: no third-party hosts, no network at all after load, nothing stored.
test('no network after load, no third-party hosts, nothing stored', async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const requests: { url: string; phase: 'load' | 'after' }[] = [];
  let phase: 'load' | 'after' = 'load';
  const isLocalScheme = (url: string) => url.startsWith('blob:') || url.startsWith('data:');
  page.on('request', (r) => requests.push({ url: r.url(), phase }));
  // Workers make their own requests (the WASM); watch those too.
  context.on('request', (r) => {
    if (!requests.some((x) => x.url === r.url() && x.phase === phase))
      requests.push({ url: r.url(), phase });
  });

  await page.goto('/#e2e');
  await expect(page.getByTestId('engine-ready')).toBeAttached({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  phase = 'after';

  // Open, edit, search, zoom, download.
  await openFixture(page, 'simple.pdf');
  await expect(page.getByTestId('page')).toHaveCount(3);
  await page.evaluate(() =>
    (window as unknown as { __editor: { commit(op: unknown): Promise<void> } }).__editor.commit({
      kind: 'meta.setTitle',
      title: 'x',
    }),
  );
  await page.getByLabel('Search').fill('needle');
  await page.getByLabel('Search').press('Enter');
  await expect(page.getByTestId('search-summary')).toHaveText('1 of 2');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  await download;
  // Let any stray async request surface before asserting.
  await page.waitForTimeout(500);

  const foreign = requests.filter((r) => !r.url.startsWith(origin) && !isLocalScheme(r.url));
  expect(foreign, 'requests to non-origin hosts').toEqual([]);
  const afterLoad = requests.filter((r) => r.phase === 'after' && !isLocalScheme(r.url));
  expect(afterLoad, 'requests after the initial load').toEqual([]);

  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    idb: (await indexedDB.databases()).length,
    cookie: document.cookie,
    serviceWorkers: (await navigator.serviceWorker?.getRegistrations())?.length ?? 0,
    caches: 'caches' in self ? (await caches.keys()).length : 0,
  }));
  expect(storage).toEqual({
    local: 0,
    session: 0,
    idb: 0,
    cookie: '',
    serviceWorkers: 0,
    caches: 0,
  });
  expect(await context.cookies()).toEqual([]);
});

test('serves the §8 security headers', async ({ request }) => {
  const res = await request.get('/');
  const headers = res.headers();
  expect(headers['content-security-policy']).toBe(
    "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
  );
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['permissions-policy']).toContain('camera=()');
});

test('the CSP blocks a third-party request if one were attempted', async ({ page }) => {
  await page.goto('/#e2e');
  await expect(page.getByTestId('engine-ready')).toBeAttached({ timeout: 30_000 });
  const result = await page.evaluate(async () => {
    const violations: string[] = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      violations.push(e.violatedDirective),
    );
    let outcome = 'sent';
    try {
      await fetch(['https:', '', 'example.com', 'x'].join('/'));
    } catch {
      outcome = 'blocked';
    }
    await new Promise((r) => setTimeout(r, 100));
    return { outcome, violations };
  });
  expect(result.outcome).toBe('blocked');
  expect(result.violations).toContain('connect-src');
});
