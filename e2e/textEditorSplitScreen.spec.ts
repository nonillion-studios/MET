import { test, expect, type Page } from '@playwright/test';
import { openStudio } from './studioFixture';

/**
 * Fix 2: split screen as a real flex-row layout — never a popup, the manga preview always on the
 * right. Shares `openTextEditor`'s shape with textEditor.spec.ts rather than importing it — see
 * textEditorSidebar.spec.ts's own note on this repo's small-helper-duplication convention.
 */
async function openTextEditor(page: Page): Promise<void> {
  await openStudio(page);
  await page.getByRole('button', { name: 'Open Text Editor', exact: true }).click();
  await page.locator('.te-page').first().waitFor({ state: 'visible' });
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
});

test('opens as two side-by-side columns, never a popup, manga preview always on the right', async ({ page }) => {
  await openTextEditor(page);
  const editorPage = page.locator('.te-page').first();
  const editorBoxBefore = (await editorPage.boundingBox())!;

  await page.getByRole('button', { name: 'Toggle split screen' }).click();
  await expect(page.getByText('Manga Preview')).toBeVisible();

  // The A4 page is a fixed 794px wide and stays that size even when its column narrows (it just
  // gets less surrounding gutter, or scrolls, rather than distorting) — so compare column
  // boundaries via the divider (a real, precisely-positioned element) instead of the page
  // content's own bounding box, which doesn't reflect the column shrinking at this viewport size.
  const divider = page.getByRole('separator', { name: 'Resize split screen' });
  const dividerBox = (await divider.boundingBox())!;
  const previewPanel = page.getByText('Manga Preview').locator('../..');
  const previewBox = (await previewPanel.boundingBox())!;
  const editorBoxAfter = (await editorPage.boundingBox())!;

  expect(editorBoxAfter.width).toBe(editorBoxBefore.width); // the page itself never distorts
  // Manga preview sits to the right of the divider, which itself sits to the right of the editor,
  // and gets real width — proof this is a laid-out column, not a zero-width sliver or an overlay.
  expect(dividerBox.x).toBeGreaterThan(editorBoxAfter.x);
  expect(previewBox.x).toBeGreaterThanOrEqual(dividerBox.x + dividerBox.width - 2);
  expect(previewBox.width).toBeGreaterThanOrEqual(300);
});

test('shows chapter dropdown, page nav, upload, and close controls', async ({ page }) => {
  await openTextEditor(page);
  await page.getByRole('button', { name: 'Toggle split screen' }).click();
  await expect(page.getByText('Manga Preview')).toBeVisible();
  await expect(page.locator('select').filter({ hasText: /No chapters|E2E/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload reference image' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close split screen' })).toBeVisible();
});

test('dragging the divider changes the split ratio and persists it', async ({ page }) => {
  await openTextEditor(page);
  await page.getByRole('button', { name: 'Toggle split screen' }).click();
  await expect(page.getByText('Manga Preview')).toBeVisible();

  const divider = page.getByRole('separator', { name: 'Resize split screen' });
  const before = (await divider.boundingBox())!;

  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x - 150, before.y + before.height / 2, { steps: 10 });
  await page.mouse.up();

  const after = (await divider.boundingBox())!;
  expect(after.x).toBeLessThan(before.x - 50);

  const stored = await page.evaluate(() => localStorage.getItem('text_editor_split_ratio'));
  expect(stored).not.toBeNull();
  expect(Number(stored)).toBeLessThan(0.5);
});

test('close button exits split screen and returns to full width', async ({ page }) => {
  await openTextEditor(page);
  await page.getByRole('button', { name: 'Toggle split screen' }).click();
  await expect(page.getByText('Manga Preview')).toBeVisible();

  await page.getByRole('button', { name: 'Close split screen' }).click();
  await expect(page.getByText('Manga Preview')).toBeHidden();
});

test('Escape exits split screen', async ({ page }) => {
  await openTextEditor(page);
  await page.getByRole('button', { name: 'Toggle split screen' }).click();
  await expect(page.getByText('Manga Preview')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByText('Manga Preview')).toBeHidden();
});

test('editing on the left keeps working while split screen is active', async ({ page }) => {
  await openTextEditor(page);
  await page.getByRole('button', { name: 'Toggle split screen' }).click();
  await expect(page.getByText('Manga Preview')).toBeVisible();

  const editorPage = page.locator('.te-page').first();
  await editorPage.click();
  await page.keyboard.type('hello while split');
  await expect(editorPage).toContainText('hello while split');
});

test('sidebar, editor, divider, and preview are all visible together', async ({ page }) => {
  await openTextEditor(page);
  await page.getByRole('button', { name: 'Toggle split screen' }).click();
  await expect(page.getByPlaceholder('Search documents…')).toBeVisible();
  await expect(page.locator('.te-page').first()).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize split screen' })).toBeVisible();
  await expect(page.getByText('Manga Preview')).toBeVisible();
});

test('fullscreen keeps split screen correctly proportioned and controls reachable', async ({ page }) => {
  await openTextEditor(page);
  await page.getByRole('button', { name: 'Toggle split screen' }).click();
  await expect(page.getByText('Manga Preview')).toBeVisible();

  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);

  await expect(page.getByText('Manga Preview')).toBeVisible();
  await expect(page.locator('select').filter({ hasText: /No chapters|E2E/ })).toBeVisible();
  const editorPage = page.locator('.te-page').first();
  const previewPanel = page.getByText('Manga Preview').locator('..').locator('..');
  const editorBox = (await editorPage.boundingBox())!;
  const previewBox = (await previewPanel.boundingBox())!;
  expect(previewBox.x).toBeGreaterThanOrEqual(editorBox.x);
});
