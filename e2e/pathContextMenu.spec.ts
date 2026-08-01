import { test, expect } from '@playwright/test';
import { openStudio, openLayersPanel, countDarkPixels } from './studioFixture';

/** Fix 6: right-click a closed path for Make Selection/Fill Path/Stroke Path/Delete Path, instead
 *  of only reaching these through the top menu bar. */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

test('right-click a closed path shows Make Selection; painting afterward clips to it', async ({ page }) => {
  await openLayersPanel(page);
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);

  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // Enter merely *commits* a path, open or closed — it does not close it. Closing requires clicking
  // back on the first anchor (pathTool.spec.ts's own convention), which is what "Make Selection"
  // needs to be offered at all.
  await page.keyboard.press('p');
  await page.mouse.click(cx - 60, cy - 60);
  await page.mouse.click(cx + 60, cy - 60);
  await page.mouse.click(cx, cy + 60);
  await page.mouse.click(cx - 60, cy - 60);
  await page.waitForTimeout(300);
  await expect(page.getByText(/^Path \d+$/).first()).toBeVisible();

  // Right-click on the path's own stroke (its top edge, roughly midway between the two top anchors).
  await page.mouse.click(cx, cy - 60, { button: 'right' });
  const menuItem = page.getByRole('button', { name: 'Make Selection', exact: true });
  await expect(menuItem).toBeVisible({ timeout: 5_000 });
  await menuItem.click();
  await page.waitForTimeout(300);

  // Switch to the raster layer and paint across the triangle — a real selection clips the stroke.
  await page.locator('button').filter({ has: page.getByText('Layer 1', { exact: true }) }).first().click();
  await page.keyboard.press('b');
  const strokeY = cy - 20;
  await page.mouse.move(cx - 90, strokeY);
  await page.mouse.down();
  await page.mouse.move(cx + 90, strokeY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const isGrey = (c: { r: number; g: number; b: number }) => Math.abs(c.r - 128) < 20 && Math.abs(c.g - 128) < 20 && Math.abs(c.b - 128) < 20;
  async function pixelAt(x: number, y: number) {
    const shot = await page.screenshot({ clip: { x: x - 4, y: y - 4, width: 8, height: 8 } });
    return page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = `data:image/png;base64,${b64}`; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let r = 0, g = 0, bl = 0;
      const n = data.length / 4;
      for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; bl += data[i + 2]; }
      return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(bl / n) };
    }, shot.toString('base64'));
  }

  const outsideLeft = await pixelAt(cx - 90, strokeY);
  expect(isGrey(outsideLeft), `stroke should be clipped outside the path, got ${JSON.stringify(outsideLeft)}`).toBe(true);
});

test('right-click an open path has no Make Selection item, but Delete Path works', async ({ page }) => {
  await openLayersPanel(page);
  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await page.keyboard.press('p');
  await page.mouse.click(cx - 40, cy);
  await page.mouse.click(cx, cy - 40);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await expect(page.getByText(/^Path \d+$/).first()).toBeVisible();

  const before = await countDarkPixels(page);
  await page.mouse.click(cx - 20, cy - 20, { button: 'right' });
  await expect(page.getByRole('button', { name: 'Delete Path', exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('button', { name: 'Make Selection', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete Path', exact: true }).click();
  await page.waitForTimeout(300);
  const after = await countDarkPixels(page);
  expect(after, `path stroke should be gone after Delete Path, before=${before} after=${after}`).toBeLessThan(before);
});
