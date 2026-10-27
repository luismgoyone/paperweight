import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { openApp, openFixture } from './helpers';

const commitTitle = (page: Page, title: string) =>
  page.evaluate(
    (t) =>
      (window as unknown as { __editor: { commit(op: unknown): Promise<void> } }).__editor.commit({
        kind: 'meta.setTitle',
        title: t,
      }),
    title,
  );

async function downloadAndOpen(page: Page, trigger: () => Promise<void>) {
  const downloadEvent = page.waitForEvent('download');
  await trigger();
  const download = await downloadEvent;
  const bytes = readFileSync(await download.path());
  return {
    name: download.suggestedFilename(),
    bytes,
    doc: mupdf.Document.openDocument(bytes, 'application/pdf'),
  };
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openFixture(page, 'simple.pdf');
  await expect(page.getByTestId('page')).toHaveCount(3);
});

test('downloads a byte-valid edited PDF named <name>-edited.pdf', async ({ page }) => {
  await commitTitle(page, 'Edited');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  const { name, bytes, doc } = await downloadAndOpen(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  expect(name).toBe('simple-edited.pdf');
  expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
  expect(doc.countPages()).toBe(3);
  expect(doc.getMetaData('info:Title')).toBe('Edited');
});

test('undo and redo change what gets downloaded; ⌘S downloads', async ({ page }) => {
  await commitTitle(page, 'First');
  await commitTitle(page, 'Second');
  await page.getByRole('button', { name: 'Undo' }).click();
  let { doc } = await downloadAndOpen(page, () => page.keyboard.press('ControlOrMeta+s'));
  expect(doc.getMetaData('info:Title')).toBe('First');

  await page.getByRole('button', { name: 'Redo' }).click();
  ({ doc } = await downloadAndOpen(page, () => page.keyboard.press('ControlOrMeta+s')));
  expect(doc.getMetaData('info:Title')).toBe('Second');

  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  ({ doc } = await downloadAndOpen(page, () => page.keyboard.press('ControlOrMeta+s')));
  expect(doc.getMetaData('info:Title')).toBe('Fixture');
});

async function closePrompts(page: Page) {
  // Chrome only shows the beforeunload prompt after a user gesture on the page.
  await page.getByTestId('viewer').click();
  const dialog = page
    .waitForEvent('dialog', { timeout: 3000 })
    .then(async (d) => {
      const type = d.type();
      await d.accept();
      return type;
    })
    .catch(() => null);
  await page.close({ runBeforeUnload: true });
  return dialog;
}

test('warns before leaving with unsaved changes', async ({ page }) => {
  await commitTitle(page, 'Unsaved');
  expect(await closePrompts(page)).toBe('beforeunload');
});

test('does not warn after the changes were downloaded', async ({ page }) => {
  await commitTitle(page, 'Saved');
  await downloadAndOpen(page, () => page.getByRole('button', { name: 'Download PDF' }).click());
  expect(await closePrompts(page)).toBeNull();
});

test('does not warn when nothing changed', async ({ page }) => {
  expect(await closePrompts(page)).toBeNull();
});

test('recovers from an engine crash without losing edits', async ({ page }) => {
  await commitTitle(page, 'Before crash');
  await page.evaluate(() =>
    (
      window as unknown as { __editor: { simulateEngineCrash(): Promise<void> } }
    ).__editor.simulateEngineCrash(),
  );
  await expect(page.getByRole('status')).toContainText('No edits were lost');
  await expect(page.locator('[data-page="1"] canvas[data-rendered]')).toBeAttached();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  const { doc } = await downloadAndOpen(page, () => page.keyboard.press('ControlOrMeta+s'));
  expect(doc.getMetaData('info:Title')).toBe('Before crash');
});

test('renaming the file names the download after it', async ({ page }) => {
  await page.getByTestId('file-name').click();
  const input = page.getByRole('textbox', { name: 'File name' });
  await expect(input).toHaveValue('simple');
  await input.fill('Signed contract');
  await input.press('Enter');
  await expect(page.getByTestId('file-name')).toHaveText('Signed contract.pdf');

  const { name } = await downloadAndOpen(page, () =>
    page.getByRole('button', { name: 'Download PDF' }).click(),
  );
  expect(name).toBe('Signed contract.pdf');
});

test('Escape or a blank name leaves the file name alone', async ({ page }) => {
  await page.getByTestId('file-name').click();
  await page.getByRole('textbox', { name: 'File name' }).fill('nope');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('file-name')).toHaveText('simple.pdf');

  await page.getByTestId('file-name').click();
  await page.getByRole('textbox', { name: 'File name' }).fill('   ');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('file-name')).toHaveText('simple.pdf');

  const { name } = await downloadAndOpen(page, () => page.keyboard.press('ControlOrMeta+s'));
  expect(name).toBe('simple-edited.pdf');
});

test('⌘S while renaming saves under the new name', async ({ page }) => {
  await page.getByTestId('file-name').click();
  await page.getByRole('textbox', { name: 'File name' }).fill('quick');
  const { name } = await downloadAndOpen(page, () => page.keyboard.press('ControlOrMeta+s'));
  expect(name).toBe('quick.pdf');
});
