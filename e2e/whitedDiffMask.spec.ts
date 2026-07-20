import { test, expect } from '@playwright/test';
import { openStudio } from './studioFixture';

/**
 * Builds a same-size PNG that's identical to the seeded flat-grey page (#808080) except for a
 * solid white rectangle — the "whited" reference a user would upload after manually erasing text
 * in an external editor. `computeWhitedDiffMask` should flag only that rectangle as changed.
 */
async function makeWhitedPageBuffer(page: import('@playwright/test').Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 600;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 400, 600);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(100, 150, 150, 100);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

test('whited-page diff creates a masked clean-patch layer only over the changed region', async ({ page }) => {
  await openStudio(page);

  await page.getByRole('button', { name: 'Add pages' }).click();
  await expect(page.getByText('Manage Pages')).toBeVisible();

  const whitedBuffer = await makeWhitedPageBuffer(page);
  const whitedInputs = page.locator('input[type="file"][accept="image/*"]');
  // Original(0), Cleaned(1), Whited(2) — three per-kind "Images" file inputs, in DOM order.
  await whitedInputs.nth(2).setInputFiles({ name: 'page-001-whited.png', mimeType: 'image/png', buffer: whitedBuffer });

  await expect(page.getByText('Create Patch Layer from Diff')).toBeVisible({ timeout: 15_000 });
  await page.getByText('Create Patch Layer from Diff').click();

  await expect(page.getByText('Patch layer created')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /close/i }).first().click();

  // The Layers panel should now show the new "Whited Patch" layer.
  await expect(page.getByText('Whited Patch')).toBeVisible();
});
