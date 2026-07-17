import { test, expect } from '@playwright/test';
import { openStudio, countDarkPixels, paintStroke, readStudioStore, typeIntoTextLayer } from './studioFixture';

/**
 * Drives the real Layers panel against a real Konva stage. These exist because the layer-tree
 * refactor rewrote every layer mutation: the unit tests prove `layerTree` is correct in isolation,
 * but only this can show the Studio is still wired to it.
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

/**
 * The panel row for exactly this layer.
 *
 * Must be exact: `hasText` is a substring match, so "Layer 1" also matches the "Layer 1 copy" row —
 * and since the panel renders top-most first, the copy comes back *before* the original.
 */
const layerRow = (page: import('@playwright/test').Page, name: string) =>
  page.locator('button').filter({ has: page.getByText(name, { exact: true }) }).first();

/** A `paintStroke` lays down ~850 dark pixels; 300 is a comfortable floor that anti-aliasing and
 *  zoom-fit variation can't dip below, while still being far above zero. */
const STROKE_PIXELS = 300;

test('a fresh chapter has exactly one locked Background layer', async ({ page }) => {
  await expect(page.getByText('Background', { exact: true })).toHaveCount(1);
});

test('adds, duplicates and deletes a raster layer', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await expect(page.getByText('Layer 1', { exact: true })).toBeVisible();

  // Expanding the row reveals the per-layer actions.
  await layerRow(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Duplicate layer' }).first().click();
  await expect(page.getByText('Layer 1 copy', { exact: true })).toBeVisible();

  await layerRow(page, 'Layer 1 copy').click();
  await page.getByRole('button', { name: 'Delete layer' }).first().click();
  await expect(page.getByText('Layer 1 copy', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Layer 1', { exact: true })).toBeVisible();
});

test('duplicating a painted layer copies its pixels, not a blank canvas', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();

  // The stage has a standing population of dark pixels (the page drop-shadow), so every assertion
  // here is a *delta* against this baseline — an absolute "> 0" would pass on a blank stage.
  const baseline = await countDarkPixels(page);

  await page.keyboard.press('b');
  await paintStroke(page);
  const painted = await countDarkPixels(page);
  expect(painted).toBeGreaterThan(baseline + STROKE_PIXELS);

  await page.keyboard.press('v');
  // Expand Layer 1's row; it stays expanded through the duplicate, so the actions below all belong
  // to it. (Clicking the row again would *collapse* it and hide them.)
  await layerRow(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Duplicate layer' }).first().click();
  await expect(page.getByText('Layer 1 copy', { exact: true })).toBeVisible();

  // Delete the *original*, leaving only the copy. The stroke must still be on screen — if the copy
  // got a blank canvas (the pre-cloneSubtree bug, where the registry is keyed by layer id and was
  // never cloned) the stroke vanishes here and the count drops to zero.
  await page.getByRole('button', { name: 'Delete layer' }).first().click();
  await expect(page.getByText('Layer 1', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Layer 1 copy', { exact: true })).toBeVisible();

  expect(await countDarkPixels(page)).toBeGreaterThan(baseline + STROKE_PIXELS);
});

test('the Background layer cannot be moved out of index 0', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await layerRow(page, 'Background').click();

  // The old guard only checked the *target* slot, so Background could swap upward out of index 0.
  await expect(page.getByRole('button', { name: 'Move up' }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move down' }).first()).toBeDisabled();
});

test('reorders a layer and keeps the background pinned at the bottom', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.getByRole('button', { name: 'Add layer' }).click();
  await expect(page.getByText('Layer 2', { exact: true })).toBeVisible();

  await layerRow(page, 'Layer 1').click();
  const moveDown = page.getByRole('button', { name: 'Move down' }).first();
  // Layer 1 sits directly above Background, so it can't go lower.
  await expect(moveDown).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move up' }).first()).toBeEnabled();
});

test('toggles visibility and lock', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  // Target the aria-label directly: the eye/lock toggles are role=button spans *inside* the row
  // button, so the row inherits their text into its own accessible name and a by-role lookup
  // matches the row first — which would select the layer instead of toggling it.
  await page.locator('[aria-label="Hide Layer 1"]').click();
  await expect(page.locator('[aria-label="Show Layer 1"]')).toBeVisible();

  await page.locator('[aria-label="Lock Layer 1"]').click();
  await expect(page.locator('[aria-label="Unlock Layer 1"]')).toBeVisible();
});

test('a text layer persists at schema v5', async ({ page }) => {
  // Keyboard shortcuts are the stable way to pick a tool — the rail collapses by breakpoint.
  await page.keyboard.press('t');
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await typeIntoTextLayer(page, 'hello');
  await page.keyboard.press('Escape');

  // The glyphs live on the Konva canvas, not in the DOM, so read the store instead — which is what
  // the v5 migration actually changed. Poll: autosave is debounced, and a fixed sleep is flaky
  // under load.
  await expect.poll(async () => (await readStudioStore(page))?.layersJson ?? '', { timeout: 15_000 })
    .toContain('hello');
  expect((await readStudioStore(page))!.schemaVersion).toBe(5);
});

test('a painted raster layer persists its pixels', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.keyboard.press('b');
  await paintStroke(page);

  await expect.poll(async () => (await readStudioStore(page))?.layersJson ?? '', { timeout: 15_000 })
    .toContain('"raster":"data:image/png');
});
