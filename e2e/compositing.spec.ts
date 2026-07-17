import { test, expect } from '@playwright/test';
import { openStudio, sampleStageColor, countDarkPixels, paintStroke, typeIntoTextLayer } from './studioFixture';

/**
 * Compositing behaviour of the collapsed Konva stack — one Layer, one Group per StudioLayer.
 *
 * The seeded page is flat #808080 and a new raster layer is seeded with a copy of the background,
 * so a blend mode applied to it has an exactly predictable result. That's the whole point: before
 * the collapse each StudioLayer owned a separate canvas, and `Container.drawScene` applies the
 * composite op while drawing children into the *current* canvas — which for a Layer starts empty.
 * Multiply against nothing returns the source, so every blend mode silently no-opped on screen
 * while `exportImage.ts` (one canvas, always) applied them correctly. Screen and export disagreed.
 */

const GREY = 128;
/** JPEG-free screenshot, but antialiasing and scaling still cost a point or two. */
const TOLERANCE = 4;

const near = (actual: number, expected: number) => Math.abs(actual - expected) <= TOLERANCE;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

async function addLayerAndOpenItsRow(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(500);
  await page.locator('button').filter({ has: page.getByText('Layer 1', { exact: true }) }).first().click();
}

test('the page renders at its true colour with no layers', async ({ page }) => {
  const c = await sampleStageColor(page);
  expect(near(c.r, GREY) && near(c.g, GREY) && near(c.b, GREY)).toBe(true);
});

test('a new raster layer is seeded with a copy of the background', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(500);
  // Hide the background: the page area stays grey only because Layer 1 holds a copy of it.
  await page.locator('[aria-label="Hide Background"]').click();
  await page.waitForTimeout(400);

  const c = await sampleStageColor(page);
  expect(near(c.r, GREY)).toBe(true);
});

test('multiply blends against the background', async ({ page }) => {
  await addLayerAndOpenItsRow(page);
  await page.locator('select').first().selectOption('multiply');
  await page.waitForTimeout(500);

  // grey x grey = 128*128/255 ~= 64. Before the collapse this stayed at 128.
  const c = await sampleStageColor(page);
  expect(near(c.r, 64), `expected ~64, got ${c.r}`).toBe(true);
});

test('screen blends against the background', async ({ page }) => {
  await addLayerAndOpenItsRow(page);
  await page.locator('select').first().selectOption('screen');
  await page.waitForTimeout(500);

  // screen(grey, grey) = 255 - (127*127/255) ~= 191.
  const c = await sampleStageColor(page);
  expect(near(c.r, 191), `expected ~191, got ${c.r}`).toBe(true);
});

test('layer opacity fades a layer toward what is beneath it', async ({ page }) => {
  await addLayerAndOpenItsRow(page);
  // Multiply at full strength is 64; at 50% opacity it composites halfway back to the grey
  // underneath, i.e. ~96. This checks opacity and blend interact, not just that each runs.
  await page.locator('select').first().selectOption('multiply');
  await page.locator('input[type=range]').first().fill('50');
  await page.waitForTimeout(500);

  const c = await sampleStageColor(page);
  expect(near(c.r, 96), `expected ~96, got ${c.r}`).toBe(true);
});

test('hiding a layer removes it from the composite', async ({ page }) => {
  await addLayerAndOpenItsRow(page);
  await page.locator('select').first().selectOption('multiply');
  await page.waitForTimeout(400);
  expect(near((await sampleStageColor(page)).r, 64)).toBe(true);

  await page.locator('[aria-label="Hide Layer 1"]').click();
  await page.waitForTimeout(400);
  expect(near((await sampleStageColor(page)).r, GREY)).toBe(true);
});

test('the View Original overlay still sits above the background', async ({ page }) => {
  // With no cleaned page the overlay is inert, but the node ordering still has to hold: the page
  // must render normally rather than being covered or hidden by the overlay slot.
  const c = await sampleStageColor(page);
  expect(near(c.r, GREY)).toBe(true);
  await expect(page.locator('.konvajs-content canvas').first()).toBeVisible();
});

test('text renders and stays clickable inside the collapsed stack', async ({ page }) => {
  const before = await countDarkPixels(page);

  await page.keyboard.press('t');
  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await typeIntoTextLayer(page, 'WWWW');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Glyphs are canvas pixels, never DOM — probe for them.
  expect(await countDarkPixels(page)).toBeGreaterThan(before);

  // Now hit-testing: clicking the glyphs with the Move tool must select that layer. Text nodes are
  // nested inside a Group now rather than owning a Konva Layer, so this is the thing most likely to
  // have broken. Creating text auto-switches the dock to the Text panel, so go back to Layers.
  await page.keyboard.press('v');
  await page.mouse.click(cx, cy);
  await page.getByRole('tab', { name: 'Layers' }).or(page.getByText('Layers', { exact: true })).first().click();
  await expect(page.getByText('Text 1', { exact: true })).toBeVisible();
});

test('painting still lands on the active layer after the collapse', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  const before = await countDarkPixels(page);
  await page.keyboard.press('b');
  await paintStroke(page);
  expect(await countDarkPixels(page)).toBeGreaterThan(before + 300);
});

test('zooming does not disturb the composite', async ({ page }) => {
  await addLayerAndOpenItsRow(page);
  await page.locator('select').first().selectOption('multiply');
  await page.waitForTimeout(400);

  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(500);

  // Still the multiplied value — zoom is a stage transform and must not change compositing.
  expect(near((await sampleStageColor(page)).r, 64)).toBe(true);
});
