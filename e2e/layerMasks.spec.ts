import { test, expect, type Page } from '@playwright/test';
import { openStudio, navigateToStudio, countDarkPixels, paintStroke, readStudioStore } from './studioFixture';

/**
 * Real layer masks — the last missing piece of the layer-tree refactor (groups/clipping/adjustment
 * stacking were already real; masks were declared in the type but never rendered, painted, exported
 * or persisted). Drives the actual Layers panel + canvas, since the trim only shows up as pixels on
 * a real Konva stage — nothing here is visible to a DOM-only assertion.
 *
 * Every dark-pixel comparison happens with the Select tool active and the Layers panel row already
 * expanded. Both a paint tool's options bar and the row's own disclosure change the canvas
 * container's size, which shifts the raw dark-pixel count on its own — comparing counts taken under
 * different tools/layouts looks like a content change but isn't. `paintAndVerify` below always
 * paints under the requested tool, then switches back to Select *before* taking the measurement
 * it retries against, so every comparison in this file is apples-to-apples.
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

/** The panel row for exactly this layer — must be exact, or "Layer 1" also matches "Layer 1 copy". */
const layerRow = (page: Page, name: string) =>
  page.locator('button').filter({ has: page.getByText(name, { exact: true }) }).first();

/** A `paintStroke` lays down ~850 dark pixels; 300 is a comfortable floor. */
const STROKE_PIXELS = 300;

/**
 * Presses `toolKey`, drags a stroke, switches back to Select, and measures — retrying the whole
 * cycle a few times until `predicate` holds. Retried because a single synthetic mouse drag
 * occasionally doesn't register (headless Chromium pointer events aren't perfectly reliable under
 * load), and always measuring from the *same* tool state (Select) keeps every comparison honest.
 */
async function paintAndVerify(page: Page, toolKey: string, predicate: (dark: number) => boolean, attempts = 8): Promise<number> {
  let dark = -1;
  for (let i = 0; i < attempts; i++) {
    await page.keyboard.press(toolKey);
    await paintStroke(page);
    await page.keyboard.press('v');
    await page.waitForTimeout(400);
    dark = await countDarkPixels(page);
    if (predicate(dark)) return dark;
  }
  return dark;
}

test('a mask trims a layer\'s content, paint/erase edits it, and it persists and duplicates independently', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.keyboard.press('v');
  await layerRow(page, 'Layer 1').click();
  const baseline = await countDarkPixels(page);

  const painted = await paintAndVerify(page, 'b', (d) => d > baseline + STROKE_PIXELS);
  expect(painted).toBeGreaterThan(baseline + STROKE_PIXELS);

  await page.getByRole('button', { name: 'Add mask', exact: true }).click();
  // No selection was active when the mask was added, so it reveals everything — content unchanged.
  await expect.poll(() => countDarkPixels(page), { timeout: 10_000 }).toBe(painted);

  // Click the mask's thumbnail chip to make it the paint target, then erase over the painted stroke.
  await page.getByRole('button', { name: "Edit Layer 1's mask", exact: true }).click();
  const afterErase = await paintAndVerify(page, 'e', (d) => d < painted);
  expect(afterErase).toBeLessThan(painted);

  await expect.poll(async () => (await readStudioStore(page))?.layersJson ?? '', { timeout: 15_000 })
    .toContain('"maskRaster"');

  // Reload the whole app and confirm the trim survived a real save/load round trip.
  await page.reload();
  await navigateToStudio(page);
  await expect.poll(async () => countDarkPixels(page), { timeout: 15_000 }).toBeLessThan(painted);

  // Duplicate the masked layer — its mask must be its own canvas, not shared with the original's
  // (the exact class of bug `cloneSubtree`'s id-remapping exists to prevent).
  await layerRow(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Duplicate layer' }).first().click();
  await expect(page.getByText('Layer 1 copy', { exact: true })).toBeVisible();

  await expect.poll(async () => (await readStudioStore(page))?.layersJson ?? '', { timeout: 15_000 })
    .toContain('Layer 1 copy');
  const store = await readStudioStore(page);
  const layersByPage = JSON.parse(store!.layersJson) as Record<string, { name: string; mask?: { id: string; enabled: boolean } }[]>;
  const maskedLayers = Object.values(layersByPage).flat().filter(l => l.mask);
  expect(maskedLayers).toHaveLength(2);
  const maskIds = new Set(maskedLayers.map(l => l.mask!.id));
  expect(maskIds.size).toBe(2);
});

test('a disabled mask has no effect, and re-enabling it restores the trim', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.keyboard.press('v');
  await layerRow(page, 'Layer 1').click();
  const baseline = await countDarkPixels(page);

  const painted = await paintAndVerify(page, 'b', (d) => d > baseline + STROKE_PIXELS);
  expect(painted).toBeGreaterThan(baseline + STROKE_PIXELS);

  await page.getByRole('button', { name: 'Add mask', exact: true }).click();
  await page.getByRole('button', { name: "Edit Layer 1's mask", exact: true }).click();
  const afterErase = await paintAndVerify(page, 'e', (d) => d < painted);
  expect(afterErase).toBeLessThan(painted);

  // Disabling the mask must bring back the full, untrimmed content.
  await page.getByRole('button', { name: 'Disable layer mask' }).click();
  await expect.poll(() => countDarkPixels(page), { timeout: 10_000 }).toBe(painted);

  // Re-enabling restores the trim.
  await page.getByRole('button', { name: 'Enable layer mask' }).click();
  await expect.poll(() => countDarkPixels(page), { timeout: 10_000 }).toBe(afterErase);
});
