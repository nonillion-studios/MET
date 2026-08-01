import { test, expect } from '@playwright/test';
import { openStudio, navigateToStudio } from './studioFixture';

/** Fix 4: Color panel hex partial-typing, distinct Hue/Brightness Cube pickers, persisted recents. */

test('Hex field keeps partial input instead of snapping back mid-type', async ({ page }) => {
  await openStudio(page);
  const hexInput = page.locator('label:has-text("Hex") input').first();
  await hexInput.click();
  await hexInput.fill('');
  await hexInput.pressSequentially('3c9', { delay: 30 });
  // A pre-fix controlled input bound straight to the committed color would revert to "#000000"
  // (or whatever was last valid) after each keystroke that doesn't yet form a full 6-digit hex.
  await expect(hexInput).toHaveValue('3c9');
  await hexInput.pressSequentially('f21');
  await expect(hexInput).toHaveValue(/^#?3c9f21$/i);
});

async function fgHex(page: import('@playwright/test').Page): Promise<string> {
  const bg = await page.getByRole('button', { name: 'Foreground color' }).evaluate((el) => getComputedStyle(el).backgroundColor);
  return bg;
}

test('Hue Cube and Brightness Cube pickers actually change the foreground color', async ({ page }) => {
  await openStudio(page);

  await page.getByRole('button', { name: 'Color panel menu' }).click();
  await page.getByText('Hue Cube', { exact: true }).click();
  const before1 = await fgHex(page);
  const square1Box = (await page.locator('canvas:not(.konvajs-content canvas)').first().boundingBox())!;
  await page.mouse.click(square1Box.x + square1Box.width * 0.1, square1Box.y + square1Box.height * 0.5);
  const after1 = await fgHex(page);
  expect(after1).not.toBe(before1);

  await page.getByRole('button', { name: 'Color panel menu' }).click();
  await page.getByText('Brightness Cube', { exact: true }).click();
  const before2 = await fgHex(page);
  const square2Box = (await page.locator('canvas:not(.konvajs-content canvas)').first().boundingBox())!;
  await page.mouse.click(square2Box.x + square2Box.width * 0.9, square2Box.y + square2Box.height * 0.1);
  const after2 = await fgHex(page);
  expect(after2).not.toBe(before2);
});

test('Recent colors persist across reload', async ({ page }) => {
  await openStudio(page);
  const hexInput = page.locator('label:has-text("Hex") input').first();
  await hexInput.fill('ab12cd');
  await hexInput.press('Enter');
  await expect(page.getByLabel('Recent color #ab12cd')).toBeVisible({ timeout: 5_000 });

  await page.reload();
  await navigateToStudio(page);
  await expect(page.getByLabel('Recent color #ab12cd')).toBeVisible({ timeout: 5_000 });
});
