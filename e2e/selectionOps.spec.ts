import { test, expect } from '@playwright/test';
import { openStudio } from './studioFixture';

/**
 * Quick Mask and Transform Selection — both verified through their real, observable effect on
 * subsequent painting (clipping to the resulting selection), not by inspecting internal state.
 */

async function pixelAt(page: import('@playwright/test').Page, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
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

const isBlack = (c: { r: number; g: number; b: number }) => c.r < 40 && c.g < 40 && c.b < 40;
const isGrey = (c: { r: number; g: number; b: number }) => Math.abs(c.r - 128) < 20 && Math.abs(c.g - 128) < 20 && Math.abs(c.b - 128) < 20;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

test('Quick Mask painted region becomes a real selection that clips subsequent painting', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);

  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Proportional to the canvas's own rendered width, not a fixed pixel count — the Studio's right
  // column (Color/Layers, always visible now) genuinely narrows the canvas versus a bare dock, so a
  // fixed offset calibrated for the old, wider render could land outside the canvas entirely.
  const near = box.width * 0.1;
  const far = box.width * 0.2;

  // Enter Quick Mask and paint a solid patch on the left half only.
  await page.keyboard.press('q');
  await page.keyboard.press('b');
  await page.locator('label').filter({ hasText: 'Size' }).locator('input[type=range]').first().fill('80');
  await page.mouse.move(cx - near, cy);
  await page.mouse.down();
  await page.mouse.move(cx - near, cy, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Exit Quick Mask — the painted patch becomes the active selection.
  await page.keyboard.press('q');
  await page.waitForTimeout(300);

  // Paint a wide stroke spanning both the selected patch (left) and well outside it (right).
  await page.mouse.move(cx - near, cy);
  await page.mouse.down();
  await page.mouse.move(cx + far, cy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const insideSelection = await pixelAt(page, cx - near, cy);
  const outsideSelection = await pixelAt(page, cx + far, cy);
  expect(isBlack(insideSelection), `paint inside the quick-mask selection should land, got ${JSON.stringify(insideSelection)}`).toBe(true);
  expect(isGrey(outsideSelection), `paint outside the quick-mask selection should be clipped away, got ${JSON.stringify(outsideSelection)}`).toBe(true);
});

test('Transform Selection moves the selection geometry, not the pixels', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);

  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Marquee-select a patch on the left.
  await page.keyboard.press('m');
  await page.mouse.move(cx - 90, cy - 30);
  await page.mouse.down();
  await page.mouse.move(cx - 30, cy + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Select > Transform Selection, then drag the box 150px right and commit.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByText('Transform Selection', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.mouse.move(cx - 60, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 90, cy, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // Paint a wide stroke spanning the selection's original spot and its new (transformed) spot.
  await page.keyboard.press('b');
  await page.mouse.move(cx - 60, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 90, cy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const originalSpot = await pixelAt(page, cx - 60, cy);
  const newSpot = await pixelAt(page, cx + 90, cy);
  expect(isGrey(originalSpot), `paint at the selection's original spot should be clipped away after the transform, got ${JSON.stringify(originalSpot)}`).toBe(true);
  expect(isBlack(newSpot), `paint at the transformed selection's new spot should land, got ${JSON.stringify(newSpot)}`).toBe(true);
});
