import { test, expect } from '@playwright/test';
import { openStudio, sampleStageColor, openLayersPanel } from './studioFixture';

/**
 * Clipping masks: a clipped layer is trimmed to the alpha of the nearest non-clipped sibling below.
 *
 * The trick to observing this is that a new raster layer is seeded with an *opaque copy of the
 * page*, so erasing a hole in it changes nothing visually (grey over identical grey) while changing
 * its **alpha** — which is precisely what clipping keys on. So:
 *
 *   Layer 1  = base, with an erased hole at the centre     -> centre still reads 128
 *   Layer 2  = Multiply over it                            -> centre reads 64
 *   clip 2 to 1                                            -> centre reads 128 again (trimmed away)
 *
 * 64 vs 128 is the whole feature.
 */

const GREY = 128;
const MULTIPLIED = 64;
const TOLERANCE = 5;
const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

const row = (page: import('@playwright/test').Page, name: string) =>
  page.locator('button').filter({ has: page.getByText(name, { exact: true }) }).first();

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

/** Erases a wide band through the middle of the active layer, punching alpha out of it. */
async function eraseHole(page: import('@playwright/test').Page) {
  await page.keyboard.press('e');
  // Wide enough that the hole covers the whole sampled patch, not just part of it.
  await page.locator('label').filter({ hasText: 'Size' }).locator('input[type=range]').first().fill('200');
  const box = (await page.locator('canvas').first().boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2 - 60, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test('a clipped layer is trimmed to the alpha of the layer below', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await eraseHole(page);
  // The base is a copy of the page, so the hole is invisible — but its alpha is gone.
  expect(near((await sampleStageColor(page)).r, GREY), 'erasing the base should not change the view').toBe(true);

  await openLayersPanel(page);
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await row(page, 'Layer 2').click();
  await page.locator('select').first().selectOption('multiply');
  await page.waitForTimeout(400);
  expect(near((await sampleStageColor(page)).r, MULTIPLIED), 'multiply should darken the centre').toBe(true);

  // Clip Layer 2 to Layer 1. The centre falls in Layer 1's erased hole, so Layer 2 is trimmed away
  // there and the page shows through again.
  await page.getByRole('button', { name: 'Create clipping mask' }).click();
  await page.waitForTimeout(600);

  const c = await sampleStageColor(page);
  expect(near(c.r, GREY), `expected ~${GREY} (clipped away), got ${c.r}`).toBe(true);
});

test('releasing a clipping mask restores the layer', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await eraseHole(page);
  await openLayersPanel(page);
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await row(page, 'Layer 2').click();
  await page.locator('select').first().selectOption('multiply');
  await page.getByRole('button', { name: 'Create clipping mask' }).click();
  await page.waitForTimeout(400);
  expect(near((await sampleStageColor(page)).r, GREY)).toBe(true);

  await page.getByRole('button', { name: 'Release clipping mask' }).click();
  await page.waitForTimeout(500);
  expect(near((await sampleStageColor(page)).r, MULTIPLIED)).toBe(true);
});

test('a clipped layer keeps its own blend mode', async ({ page }) => {
  // The reason clipping composites base-alpha rather than `source-atop` per follower: source-atop
  // would occupy the follower's own globalCompositeOperation slot, and a clipped Multiply layer is
  // the standard manga shading idiom. Here the base has no hole, so the Multiply must survive.
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await row(page, 'Layer 2').click();
  await page.locator('select').first().selectOption('multiply');
  await page.getByRole('button', { name: 'Create clipping mask' }).click();
  await page.waitForTimeout(600);

  const c = await sampleStageColor(page);
  expect(near(c.r, MULTIPLIED), `expected ~${MULTIPLIED} (blend survives clipping), got ${c.r}`).toBe(true);
});

test('a clipped layer exports the same as it renders', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await eraseHole(page);
  await openLayersPanel(page);
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await row(page, 'Layer 2').click();
  await page.locator('select').first().selectOption('multiply');
  await page.getByRole('button', { name: 'Create clipping mask' }).click();
  await page.waitForTimeout(600);

  const onScreen = await sampleStageColor(page);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+e');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);

  const exported = await page.evaluate(async (data) => {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = `data:image/png;base64,${data}`; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data: px } = ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1);
    return { r: px[0], g: px[1], b: px[2] };
  }, Buffer.concat(chunks).toString('base64'));

  expect(near(exported.r, onScreen.r), `screen ${onScreen.r} vs export ${exported.r}`).toBe(true);
});
