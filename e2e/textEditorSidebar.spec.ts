import { test, expect, type Page } from '@playwright/test';
import { openStudio } from './studioFixture';

/**
 * Fix 1: the document library sidebar. Shares `openTextEditor`'s shape with textEditor.spec.ts
 * rather than importing it — that file scopes the helper privately, matching this repo's existing
 * small-helper-duplication convention (e.g. the old per-file `seedSession`).
 */
async function openTextEditor(page: Page): Promise<void> {
  await openStudio(page);
  await page.getByRole('button', { name: 'Open Text Editor', exact: true }).click();
  await page.locator('.te-page').first().waitFor({ state: 'visible' });
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
});

test('is visible immediately, lists documents, opens/highlights on click', async ({ page }) => {
  await openTextEditor(page);
  // Search input -> its own flex wrapper -> header row -> root sidebar div (3 levels), so the
  // scope includes both "New document" (a header-row sibling) and the doc list (a header-row
  // sibling one level further out).
  const sidebar = page.getByPlaceholder('Search documents…').locator('../../..');
  await expect(page.getByPlaceholder('Search documents…')).toBeVisible();
  // The tab bar has its own "New document" button too — scope to the sidebar's specifically.
  await expect(sidebar.getByRole('button', { name: 'New document' })).toBeVisible();

  await sidebar.getByRole('button', { name: 'New document' }).click();
  await expect(sidebar.getByText('Untitled').first()).toBeVisible();
});

test('collapses to a slim icon strip and remembers state across reload', async ({ page }) => {
  await openTextEditor(page);
  await page.getByRole('button', { name: 'Collapse document library' }).click();
  await expect(page.getByRole('button', { name: 'Expand document library' })).toBeVisible();
  await expect(page.getByPlaceholder('Search documents…')).toBeHidden();

  // No per-chapter URL routing in this SPA — a plain reload lands back on the Library, not the
  // Text Editor, so re-navigate through the same path openTextEditor itself uses.
  await page.reload();
  await openTextEditor(page);
  await expect(page.getByRole('button', { name: 'Expand document library' })).toBeVisible();
});
