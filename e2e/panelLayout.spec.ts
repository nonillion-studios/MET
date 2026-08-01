import { test, expect } from '@playwright/test';
import { openStudio } from './studioFixture';

/** Fix 5: Brushes defaults to visible-but-collapsed (not hidden), and a tall panel scrolls on its
 *  own instead of pushing the whole right column. */

test('Brushes panel is visible (collapsed) by default, not absent', async ({ page }) => {
  await openStudio(page);
  // A real header row for the panel means it's present in the stack — Window > Brushes toggles
  // *visibility*, which is a separate concern from this default-on-mount state.
  await expect(page.getByRole('button', { name: /Expand Brushes panel|Collapse Brushes panel/ })).toBeVisible({ timeout: 5_000 });
  // Collapsed by default: its chevron reads "Expand", not "Collapse".
  await expect(page.getByRole('button', { name: 'Expand Brushes panel' })).toBeVisible();
});

test('An expanded panel scrolls its own content instead of just growing the column', async ({ page }) => {
  await openStudio(page);
  // TypeR is expanded by default and has enough controls/content to exceed the per-panel cap.
  const typerHeader = page.getByRole('button', { name: 'Collapse TypeR panel' });
  await expect(typerHeader).toBeVisible({ timeout: 5_000 });

  const scrollInfo = await page.evaluate(() => {
    const header = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Collapse TypeR panel');
    const panelRoot = header?.closest('div.flex.flex-col.border-b') as HTMLElement | null;
    const contentDiv = panelRoot?.querySelector(':scope > div:not([draggable])') as HTMLElement | null;
    if (!contentDiv) return null;
    return { scrollHeight: contentDiv.scrollHeight, clientHeight: contentDiv.clientHeight, overflowY: getComputedStyle(contentDiv).overflowY };
  });

  expect(scrollInfo).not.toBeNull();
  expect(scrollInfo!.overflowY).toBe('auto');
});
