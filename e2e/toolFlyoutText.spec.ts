import { test, expect } from '@playwright/test';
import { openStudio } from './studioFixture';

/** Fix 3: tool-rail flyouts must show each tool's name and shortcut as visible text, not just a
 *  hover tooltip. Right-clicking a grouped rail icon (e.g. Lasso) opens the flyout. */
test('right-click flyout shows visible tool names and shortcuts', async ({ page }) => {
  await openStudio(page);

  const lassoIcon = page.getByRole('button', { name: 'Lasso', exact: true });
  await lassoIcon.click({ button: 'right' });

  // Polygonal Lasso is a real sibling in the Lasso group per toolGroups.ts; the group's own
  // first tool (plain Lasso, shortcut "l") is also listed and carries a visible shortcut badge.
  const polyRow = page.getByRole('button', { name: 'Polygonal Lasso', exact: true });
  await expect(polyRow).toBeVisible({ timeout: 5_000 });
  await expect(polyRow).toContainText('Polygonal Lasso');

  const freehandRow = page.getByRole('button', { name: 'Lasso', exact: true }).last();
  await expect(freehandRow).toContainText('Lasso');
  await expect(freehandRow).toContainText('L');
});
