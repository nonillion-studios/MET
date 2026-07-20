import { test, expect } from '@playwright/test';
import { openStudio, navigateToStudio, sampleStageColor, countDarkPixels, paintStroke, readStudioStore } from './studioFixture';

/**
 * Layer groups: the first user-visible feature of the layer-tree work.
 *
 * The interesting assertions here are the compositing ones. A group's opacity and blend mode must
 * apply to the *composited* subtree, not to each child in turn — uncached, Konva does the latter,
 * and two overlapping children in a 50% group each draw at 50% so the overlap double-darkens. That
 * failure is quiet: it just looks slightly wrong, and only disagrees with the exporter.
 */

const GREY = 128;
const TOLERANCE = 4;
const near = (actual: number, expected: number) => Math.abs(actual - expected) <= TOLERANCE;

const row = (page: import('@playwright/test').Page, name: string) =>
  page.locator('button').filter({ has: page.getByText(name, { exact: true }) }).first();

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

async function addLayers(page: import('@playwright/test').Page, n: number) {
  for (let i = 0; i < n; i += 1) await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);
}

test('groups the selected layer', async ({ page }) => {
  await addLayers(page, 1);
  await row(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Group layers' }).click();

  await expect(page.getByText('Group', { exact: true })).toBeVisible();
  await expect(page.getByText('Layer 1', { exact: true })).toBeVisible();
});

test('groups a multi-layer selection with ctrl-click', async ({ page }) => {
  await addLayers(page, 2);
  await row(page, 'Layer 1').click();
  await row(page, 'Layer 2').click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Group layers' }).click();

  await expect(page.getByText('Group', { exact: true })).toBeVisible();
  // Both members survive inside it.
  await expect(page.getByText('Layer 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Layer 2', { exact: true })).toBeVisible();
});

test('collapsing a group hides its children from the panel', async ({ page }) => {
  await addLayers(page, 1);
  await row(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Group layers' }).click();
  await expect(page.getByText('Layer 1', { exact: true })).toBeVisible();

  await page.locator('[aria-label="Collapse Group"]').click();
  await expect(page.getByText('Layer 1', { exact: true })).toHaveCount(0);

  await page.locator('[aria-label="Expand Group"]').click();
  await expect(page.getByText('Layer 1', { exact: true })).toBeVisible();
});

test('ungrouping puts the children back', async ({ page }) => {
  await addLayers(page, 1);
  await row(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Group layers' }).click();

  await row(page, 'Group').click();
  await page.getByRole('button', { name: 'Ungroup layers' }).first().click();
  await expect(page.getByText('Group', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Layer 1', { exact: true })).toBeVisible();
});

test('hiding a group hides its whole subtree on canvas', async ({ page }) => {
  await addLayers(page, 1);
  // Make Layer 1 visibly distinct from the page so hiding it is observable.
  await row(page, 'Layer 1').click();
  await page.getByRole('combobox', { name: 'Blend' }).selectOption('multiply');
  await page.waitForTimeout(400);
  expect(near((await sampleStageColor(page)).r, 64)).toBe(true);

  await row(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Group layers' }).click();
  await page.waitForTimeout(400);

  // Konva cascades visibility down a Group, so hiding the parent must hide the child's multiply.
  await page.locator('[aria-label="Hide Group"]').click();
  await page.waitForTimeout(400);
  expect(near((await sampleStageColor(page)).r, GREY)).toBe(true);
});

test('a default group is pass-through — children still blend with the page', async ({ page }) => {
  await addLayers(page, 1);
  await row(page, 'Layer 1').click();
  await page.getByRole('combobox', { name: 'Blend' }).selectOption('multiply');
  await page.waitForTimeout(400);
  expect(near((await sampleStageColor(page)).r, 64)).toBe(true);

  await row(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Group layers' }).click();
  await page.waitForTimeout(500);

  // Opacity 1 + normal blend => pass-through, Photoshop's default for a new group. The child's
  // Multiply must still reach the page underneath, so nothing about the render changes.
  const c = await sampleStageColor(page);
  expect(near(c.r, 64), `grouping changed the render: expected 64, got ${c.r}`).toBe(true);
});

test('lowering a group’s opacity makes it isolated', async ({ page }) => {
  await addLayers(page, 1);
  await row(page, 'Layer 1').click();
  await page.getByRole('combobox', { name: 'Blend' }).selectOption('multiply');
  await page.waitForTimeout(300);

  await row(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Group layers' }).click();
  await row(page, 'Group').click();
  await page.getByRole('slider', { name: 'Opacity' }).fill('50');
  await page.waitForTimeout(600);

  // Isolated: the subtree composites against nothing, so Multiply has no backdrop and the child
  // stays grey; blitting grey at 50% over a grey page leaves 128. Surprising but correct — it's
  // what Photoshop does once a group stops being pass-through.
  const c = await sampleStageColor(page);
  expect(near(c.r, 128), `expected ~128 (isolated), got ${c.r}`).toBe(true);
});

test('a two-child group at partial opacity is isolated before compositing', async ({ page }) => {
  // The isolation test. Two overlapping full-page children, both Multiply, in a 50% group:
  //
  //   cached (correct):  subtree renders alone -> grey, then x grey = 64; blit at 50% over the
  //                      page => 0.5*64 + 0.5*128 = ~96.
  //   uncached (wrong):  each child multiplies against the *page* and draws at 50% in turn =>
  //                      child A gives 96, child B multiplies that to 48 and lands at ~72.
  //
  // 96 vs 72 is the whole difference between the Photoshop model and Konva's per-child default.
  await addLayers(page, 2);
  for (const name of ['Layer 1', 'Layer 2']) {
    await row(page, name).click();
    await page.getByRole('combobox', { name: 'Blend' }).selectOption('multiply');
    await page.waitForTimeout(250);
    await row(page, name).click(); // collapse the row again
  }

  await row(page, 'Layer 1').click();
  await row(page, 'Layer 2').click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Group layers' }).click();

  await row(page, 'Group').click();
  await page.getByRole('slider', { name: 'Opacity' }).fill('50');
  await page.waitForTimeout(600);

  const c = await sampleStageColor(page);
  expect(near(c.r, 96), `expected ~96 (isolated), got ${c.r} — 72 means the group did not cache`).toBe(true);
});

test('a group survives a save/reload round-trip with its children', async ({ page }) => {
  await addLayers(page, 1);
  await row(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Group layers' }).click();

  // The group must persist as a real nested node, not flattened away.
  await expect.poll(async () => (await readStudioStore(page))?.layersJson ?? '', { timeout: 15_000 })
    .toContain('"type":"group"');
  expect((await readStudioStore(page))!.layersJson).toContain('"children"');

  await page.reload();
  await navigateToStudio(page);

  await expect(page.getByText('Group', { exact: true })).toBeVisible();
  await expect(page.getByText('Layer 1', { exact: true })).toBeVisible();
});

test('duplicating a group deep-copies its children and their pixels', async ({ page }) => {
  await addLayers(page, 1);
  await page.keyboard.press('b');
  await paintStroke(page);
  await page.keyboard.press('v');

  await row(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Group layers' }).click();
  const painted = await countDarkPixels(page);

  await row(page, 'Group').click();
  await page.getByRole('button', { name: 'Duplicate layer' }).first().click();
  await expect(page.getByText('Group copy', { exact: true })).toBeVisible();

  // Delete the original group; the copy's nested raster layer must still hold the stroke, which
  // only works if cloneSubtree's idMap cloned every descendant's canvas.
  await page.getByRole('button', { name: 'Delete layer' }).first().click();
  await expect(page.getByText('Group', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(400);

  expect(await countDarkPixels(page)).toBeGreaterThan(painted - 100);
});

test('dragging a layer onto a group reparents it into that group', async ({ page }) => {
  await addLayers(page, 2);
  // Group Layer 1 on its own, then drag Layer 2 into it.
  await row(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Group layers' }).click();
  await expect(page.getByText('Group', { exact: true })).toBeVisible();

  // Drop on the middle of the group row — the 'into' zone.
  await row(page, 'Layer 2').dragTo(row(page, 'Group'), { targetPosition: { x: 60, y: 22 } });

  // Collapsing the group is the observable proof of containment: a child row disappears with it.
  await page.locator('[aria-label="Collapse Group"]').click();
  await expect(page.getByText('Layer 2', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Layer 1', { exact: true })).toHaveCount(0);

  await page.locator('[aria-label="Expand Group"]').click();
  await expect(page.getByText('Layer 2', { exact: true })).toBeVisible();
});

test('a group cannot be dragged into itself', async ({ page }) => {
  await addLayers(page, 1);
  await row(page, 'Layer 1').click();
  await page.getByRole('button', { name: 'Group layers' }).click();

  // A cycle. `layerTree.reparent` refuses it, so this must be a no-op rather than corruption.
  await row(page, 'Group').dragTo(row(page, 'Group'), { targetPosition: { x: 60, y: 22 } });
  await expect(page.getByText('Group', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Layer 1', { exact: true })).toBeVisible();
});

test('painting inside a group with opacity still shows the stroke live', async ({ page }) => {
  await addLayers(page, 2);
  await row(page, 'Layer 1').click();
  await row(page, 'Layer 2').click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Group layers' }).click();

  // Two children + opacity < 1 is exactly the case that gets cached for isolation. A cached
  // ancestor holds a stale snapshot, so without suspending it during the stroke the brush would
  // appear to do nothing until pointerup.
  await row(page, 'Group').click();
  await page.getByRole('slider', { name: 'Opacity' }).fill('60');
  await page.waitForTimeout(400);

  await row(page, 'Layer 2').click();
  const before = await countDarkPixels(page);
  await page.keyboard.press('b');
  await paintStroke(page);
  await page.waitForTimeout(300);

  expect(await countDarkPixels(page)).toBeGreaterThan(before + 100);
});
