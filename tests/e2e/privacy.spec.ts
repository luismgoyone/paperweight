import { expect, test } from '@playwright/test';
import { openFixture } from './helpers';

// Spec §8: no third-party hosts, no network at all after load, nothing stored.
test('no network after load, no third-party hosts, nothing stored', async ({
  page,
  context,
  baseURL,
}) => {
  const appOrigin = new URL(baseURL!).origin;
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
  // Bundled fonts are part of the initial load (fetched at startup, never on demand).
  await expect(page.getByTestId('fonts-ready')).toBeAttached({ timeout: 30_000 });
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
  // Phase 2 editing: a highlight, a rectangle and added text.
  await page.getByLabel('Zoom', { exact: true }).selectOption('1');
  const origin = (await page.locator('[data-page="1"]').boundingBox())!;
  await page.getByRole('button', { name: 'Highlight' }).click();
  await page.mouse.move(origin.x + 70, origin.y + 130);
  await page.mouse.down();
  await page.mouse.move(origin.x + 300, origin.y + 130, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await page.mouse.move(origin.x + 100, origin.y + 300);
  await page.mouse.down();
  await page.mouse.move(origin.x + 200, origin.y + 360, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Add text' }).click();
  await page.mouse.click(origin.x + 100, origin.y + 500);
  await page.keyboard.type('Private note');
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.getByLabel('Search').fill('needle');
  await page.getByLabel('Search').press('Enter');
  await expect(page.getByTestId('search-summary')).toHaveText('1 of 2');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  await download;
  // Let any stray async request surface before asserting.
  await page.waitForTimeout(500);

  const foreign = requests.filter((r) => !r.url.startsWith(appOrigin) && !isLocalScheme(r.url));
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

test('signing, inserting an image and filling a form stay on the device', async ({
  page,
  context,
  baseURL,
}) => {
  const appOrigin = new URL(baseURL!).origin;
  const after: string[] = [];
  let loaded = false;
  context.on('request', (r) => {
    if (loaded && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) after.push(r.url());
    if (
      !r.url().startsWith(appOrigin) &&
      !r.url().startsWith('blob:') &&
      !r.url().startsWith('data:')
    )
      after.push(r.url());
  });
  await page.goto('/#e2e');
  await expect(page.getByTestId('fonts-ready')).toBeAttached({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  loaded = true;

  await page.getByTestId('file-input').setInputFiles('tests/fixtures/form.pdf');
  await expect(page.locator('[data-page="1"] canvas[data-rendered]')).toBeAttached();
  await page.getByLabel('Zoom', { exact: true }).selectOption('1');
  const origin = (await page.locator('[data-page="1"]').boundingBox())!;

  await page.getByRole('button', { name: 'Fill form' }).click();
  await page.getByLabel('name', { exact: true }).fill('Private Person');
  await page.getByLabel('subscribe').check();

  await page.getByRole('button', { name: 'Sign' }).click();
  const pad = (await page.getByTestId('signature-pad').boundingBox())!;
  await page.mouse.move(pad.x + 50, pad.y + 100);
  await page.mouse.down();
  await page.mouse.move(pad.x + 300, pad.y + 60, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Use signature' }).click();
  await page.mouse.click(origin.x + 400, origin.y + 380);

  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 20;
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    return [...new Uint8Array(await blob!.arrayBuffer())];
  });
  await page
    .getByTestId('image-input')
    .setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.mouse.click(origin.x + 100, origin.y + 300);

  // Phase 5: edit existing text in place ("Page 1" title at x 72, baseline 72).
  await page.getByRole('button', { name: 'Edit text' }).click();
  await page.mouse.click(origin.x + 90, origin.y + 64);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Page One');
  await page.keyboard.press('Enter');

  // Phase 4: rotate, insert another PDF, extract.
  await page.getByRole('button', { name: 'Rotate right' }).click();
  await page.getByTestId('insert-pdf-input').setInputFiles('tests/fixtures/simple.pdf');
  await expect(page.getByTestId('thumbnail')).toHaveCount(4);
  const extracted = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Extract pages' }).click();
  await extracted;

  // Phase 6: redact, compress, password.
  await page.getByRole('button', { name: 'Redact' }).click();
  await page.mouse.move(origin.x + 70, origin.y + 100);
  await page.mouse.down();
  await page.mouse.move(origin.x + 300, origin.y + 140, { steps: 4 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Apply redactions' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Redact' }).click();
  await page.getByRole('button', { name: 'More download options' }).click();
  await page.getByRole('menuitem', { name: /Compress/ }).click();
  const compressed = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download compressed' }).click();
  await compressed;
  await page.getByRole('button', { name: 'More download options' }).click();
  await page.getByRole('menuitem', { name: /Password/ }).click();
  await page.getByLabel('Open password', { exact: true }).fill('pw');
  await page.getByLabel('Repeat open password').fill('pw');
  const protectedFile = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download protected' }).click();
  await protectedFile;

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  await download;
  await page.waitForTimeout(500);

  expect(after).toEqual([]);
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    idb: (await indexedDB.databases()).length,
    cookie: document.cookie,
  }));
  expect(storage).toEqual({ local: 0, session: 0, idb: 0, cookie: '' });
});
