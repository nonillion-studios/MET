import { test, expect } from '@playwright/test';
import { openStudio, sampleStageColor, openLayersPanel } from './studioFixture';

/**
 * Export must agree with the screen.
 *
 * This is not a hypothetical: blend modes were applied correctly by `exportImage.ts` (one canvas)
 * and silently ignored on screen (one canvas per layer) for the entire life of the feature, and
 * nothing caught it because nothing compared the two. These tests decode the actual exported PNG
 * and compare its pixels against a stage sample.
 */

const TOLERANCE = 6;
const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

const row = (page: import('@playwright/test').Page, name: string) =>
  page.locator('button').filter({ has: page.getByText(name, { exact: true }) }).first();

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

/** Runs a PNG export and reads back the centre pixel of the produced file. */
async function exportedCentreColor(page: import('@playwright/test').Page) {
  // Studio shortcuts are suppressed while an <input> has focus, and `isTextInputFocused` counts a
  // range slider as one — so after touching an opacity slider, Ctrl+E silently does nothing until
  // focus moves. Blur first rather than have the test hang on it.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+e');
  const downloadPromise = page.waitForEvent('download');
  // The dialog exports straight from a per-format button; there's no confirm step.
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const b64 = Buffer.concat(chunks).toString('base64');

  return page.evaluate(async (data) => {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = `data:image/png;base64,${data}`; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data: px } = ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1);
    return { r: px[0], g: px[1], b: px[2], a: px[3] };
  }, b64);
}

test('a plain page exports at its true colour', async ({ page }) => {
  const exported = await exportedCentreColor(page);
  expect(near(exported.r, 128), `exported ${exported.r}`).toBe(true);
});

test('a multiply layer exports the same as it renders', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await row(page, 'Layer 1').click();
  await page.getByRole('combobox', { name: 'Blend' }).selectOption('multiply');
  await page.waitForTimeout(500);

  const onScreen = await sampleStageColor(page);
  const exported = await exportedCentreColor(page);
  expect(near(exported.r, onScreen.r), `screen ${onScreen.r} vs export ${exported.r}`).toBe(true);
  expect(near(exported.r, 64), `expected ~64, got ${exported.r}`).toBe(true);
});

test('a group exports the same as it renders', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await row(page, 'Layer 1').click();
  await page.getByRole('combobox', { name: 'Blend' }).selectOption('multiply');
  await page.waitForTimeout(300);

  await row(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Group layers' }).click();
  await row(page, 'Group').click();
  await page.getByRole('slider', { name: 'Opacity' }).fill('50');
  await page.waitForTimeout(600);

  // An isolated group (opacity < 1) must isolate identically on both sides. This is the assertion
  // that caught `needsIsolation` and `isolatesGroup` disagreeing: the canvas skipped the cache for
  // single-child groups, so the screen showed 96 while the file said 128.
  const onScreen = await sampleStageColor(page);
  const exported = await exportedCentreColor(page);
  expect(near(exported.r, onScreen.r), `screen ${onScreen.r} vs export ${exported.r}`).toBe(true);
  expect(near(exported.r, 128), `expected ~128 (isolated), got ${exported.r}`).toBe(true);
});

test('a pass-through group exports the same as it renders', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await row(page, 'Layer 1').click();
  await page.getByRole('combobox', { name: 'Blend' }).selectOption('multiply');
  await page.waitForTimeout(300);

  await row(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Group layers' }).click();
  await page.waitForTimeout(500);

  // Default group: the child's Multiply still reaches the page on both sides.
  const onScreen = await sampleStageColor(page);
  const exported = await exportedCentreColor(page);
  expect(near(exported.r, onScreen.r), `screen ${onScreen.r} vs export ${exported.r}`).toBe(true);
  expect(near(exported.r, 64), `expected ~64, got ${exported.r}`).toBe(true);
});

test('an adjustment exports the same as it renders', async ({ page }) => {
  // A paint layer hides the background, so this only matches if the exporter applies the
  // adjustment to the *stack below it* rather than baking it into the background as it used to.
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Add adjustment layer' }).click();
  await page.locator('label').filter({ hasText: 'Brightness' }).locator('input[type=range]').first().fill('50');
  await page.waitForTimeout(600);

  const onScreen = await sampleStageColor(page);
  const exported = await exportedCentreColor(page);
  expect(near(exported.r, onScreen.r), `screen ${onScreen.r} vs export ${exported.r}`).toBe(true);
  expect(near(exported.r, 178), `expected ~178, got ${exported.r}`).toBe(true);
});

test('an adjustment’s opacity exports the same as it renders', async ({ page }) => {
  await page.getByRole('button', { name: 'Add adjustment layer' }).click();
  await page.locator('label').filter({ hasText: 'Brightness' }).locator('input[type=range]').first().fill('50');
  await page.waitForTimeout(400);
  await openLayersPanel(page);
  await row(page, 'Brightness/Contrast').click();
  await openLayersPanel(page);
  await page.locator('label').filter({ hasText: 'Opacity' }).locator('input[type=range]').first().fill('50');
  await page.waitForTimeout(600);

  // Opacity is folded into the filter as a strength, so both renderers must agree on the midpoint.
  const onScreen = await sampleStageColor(page);
  const exported = await exportedCentreColor(page);
  expect(near(exported.r, onScreen.r), `screen ${onScreen.r} vs export ${exported.r}`).toBe(true);
  expect(near(exported.r, 153), `expected ~153, got ${exported.r}`).toBe(true);
});

test('a hidden group is left out of the export', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
  await row(page, 'Layer 1').click();
  await page.getByRole('combobox', { name: 'Blend' }).selectOption('multiply');
  await page.waitForTimeout(300);

  await row(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Group layers' }).click();
  await page.locator('[aria-label="Hide Group"]').click();
  await page.waitForTimeout(400);

  const exported = await exportedCentreColor(page);
  expect(near(exported.r, 128), `expected the bare page (128), got ${exported.r}`).toBe(true);
});
