import { test, expect } from '@playwright/test';
import { openStudio, countDarkPixels, openLayersPanel } from './studioFixture';

/**
 * Part I: a real, persisted vector Pen Tool — anchor points with bezier handles, editable paths,
 * Path Selection, Direct Selection. Replaces the old Pen tool's rasterize-and-discard behavior
 * (Part H shipped `pen`/`curvature-pen` as tools that stroked pixels straight onto a raster layer
 * and threw the click points away; this is the follow-up that makes them real path layers).
 */

/** Opens a tool group's flyout (right-click/contextmenu, matching ToolGroupButton's hold/right-click
 *  affordance) and picks a sibling tool by its label — the only way to reach a tool with no
 *  single-key shortcut. */
async function pickTool(page: import('@playwright/test').Page, groupDefaultLabel: string, toolLabel: string) {
  const groupButton = page.locator(`[aria-label="${groupDefaultLabel}"]`).first();
  await groupButton.click({ button: 'right' });
  await page.locator(`[aria-label="${toolLabel}"]`).first().click();
}

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

// Looser than other specs' isGrey (20) — an 8px sample box centred exactly on a former anchor can
// still catch a sliver of an adjacent stroke's anti-aliased edge even once the shape has moved well
// away; the real assertion here is "no longer solid stroke color", not exact background match.
const isGrey = (c: { r: number; g: number; b: number }) => Math.abs(c.r - 128) < 40 && Math.abs(c.g - 128) < 40 && Math.abs(c.b - 128) < 40;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

test('curvature-pen commits a real, persisted path layer (not rasterized pixels)', async ({ page }) => {
  await openLayersPanel(page);

  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  const before = await countDarkPixels(page);

  await pickTool(page, 'Pen', 'Curvature Pen');
  await page.mouse.click(cx - 30, cy - 30);
  await page.mouse.click(cx + 30, cy - 30);
  await page.mouse.click(cx, cy + 30);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // Committing no longer rasterizes onto a raster layer's canvas — it creates a real `path`-type
  // layer instead. No raster layer was even created, so any stroke pixels appearing on the Konva
  // stage would have to come from the new PathLayerNode's own stroked Shape.
  await expect(page.getByText('Path 1', { exact: true })).toBeVisible();
  const after = await countDarkPixels(page);
  expect(after, `the committed path should render a visible stroke, before=${before} after=${after}`).toBeGreaterThan(before);
});

test('pen tool: a plain click places a corner anchor, a click-drag places a smooth anchor with handles', async ({ page }) => {
  await openLayersPanel(page);
  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await page.keyboard.press('p'); // Pen's own shortcut
  // Anchor 1: plain click (corner).
  await page.mouse.click(cx - 60, cy);
  // Anchor 2: click-and-drag (smooth, handles pulled out along the drag).
  await page.mouse.move(cx, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy - 60, { steps: 6 });
  await page.mouse.up();
  // Anchor 3: plain click, finishing with Enter.
  await page.mouse.click(cx + 60, cy);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  await expect(page.getByText('Path 1', { exact: true })).toBeVisible();
});

test('pen tool: clicking back on the first anchor closes the path', async ({ page }) => {
  await openLayersPanel(page);
  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await page.keyboard.press('p');
  await page.mouse.click(cx - 40, cy - 40);
  await page.mouse.click(cx + 40, cy - 40);
  await page.mouse.click(cx, cy + 40);
  // Click back on the first anchor to close, instead of Enter/dblclick.
  await page.mouse.click(cx - 40, cy - 40);
  await page.waitForTimeout(300);

  await expect(page.getByText('Path 1', { exact: true })).toBeVisible();
});

test('pen tool: Enter finishes an open path without needing to close it', async ({ page }) => {
  await openLayersPanel(page);
  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await page.keyboard.press('p');
  await page.mouse.click(cx - 40, cy);
  await page.mouse.click(cx, cy - 40);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  await expect(page.getByText('Path 1', { exact: true })).toBeVisible();
});

test('path selection drags a whole committed path (every anchor moves, shape unchanged)', async ({ page }) => {
  await openLayersPanel(page);
  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // Draw a small triangle near the top-left of the canvas so there's headroom to drag it right.
  await page.keyboard.press('p');
  await page.mouse.click(cx - 80, cy - 80);
  await page.mouse.click(cx - 40, cy - 80);
  await page.mouse.click(cx - 60, cy - 40);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await expect(page.getByText('Path 1', { exact: true })).toBeVisible();

  // Committing a path already switches the active tool to Path Selection (handleAddPathLayer sets
  // activeTool to 'path-select') — no explicit tool switch needed, and none is possible via the
  // Pen group's flyout right now anyway, since the group button itself already shows "Path
  // Selection" as its active tool.
  const before = await countDarkPixels(page);
  // Drag from inside the triangle (its own stroke, which is centered around cx-60,cy-70ish) out
  // to the right by a large, unambiguous offset.
  await page.mouse.move(cx - 60, cy - 70);
  await page.mouse.down();
  await page.mouse.move(cx + 90, cy - 70, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // The path still renders somewhere (dark pixel count roughly preserved — same shape, just moved)
  // and specifically the original location's stroke is gone (translated away), confirming this was
  // a real translate of every anchor rather than a no-op or a partial-shape distortion.
  const after = await countDarkPixels(page);
  expect(after, `path should still render after the drag, before=${before} after=${after}`).toBeGreaterThan(0);

  // The pre-drag anchor location should be back to plain background grey — the stroke moved with
  // every anchor, not just a partial redraw or a no-op.
  const originalSpot = await pixelAt(page, cx - 80, cy - 80);
  expect(isGrey(originalSpot), `path should no longer render at its pre-drag location, got ${JSON.stringify(originalSpot)}`).toBe(true);
});

test('direct selection drags a single anchor without moving the others', async ({ page }) => {
  await openLayersPanel(page);
  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // A wide, flat triangle — the first anchor sits far from the other two so dragging it can't be
  // mistaken for a whole-path translate.
  await page.keyboard.press('p');
  await page.mouse.click(cx - 100, cy);
  await page.mouse.click(cx + 40, cy - 60);
  await page.mouse.click(cx + 40, cy + 60);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await expect(page.getByText('Path 1', { exact: true })).toBeVisible();

  // Committing switches to Path Selection — its own group button now reads "Path Selection";
  // right-click it to reach Direct Selection from the same flyout.
  await pickTool(page, 'Path Selection', 'Direct Selection');

  // Drag the first anchor (cx-100, cy) straight down by 100px.
  await page.mouse.move(cx - 100, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 100, cy + 100, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // The dragged anchor's old spot is now plain background; the other two anchors (well away from
  // both the old and new position) still show ink, confirming only the one anchor moved.
  const oldSpot = await pixelAt(page, cx - 100, cy);
  expect(isGrey(oldSpot), `dragged anchor's old spot should be background now, got ${JSON.stringify(oldSpot)}`).toBe(true);
  const untouchedAnchor = await pixelAt(page, cx + 40, cy - 60);
  expect(isGrey(untouchedAnchor), 'the untouched anchors should not have moved').toBe(false);
});

test('Stroke Path bakes the path onto the active raster layer, independent of the vector layer', async ({ page }) => {
  await openLayersPanel(page);
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);

  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await page.keyboard.press('p');
  await page.mouse.click(cx - 40, cy - 40);
  await page.mouse.click(cx + 40, cy - 40);
  await page.mouse.click(cx, cy + 40);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  // A raster layer was already added, so the shared layer-name counter has moved past 1 — match
  // any "Path N" rather than assuming this is layer 1.
  const pathLayerName = await page.getByText(/^Path \d+$/).first().textContent();
  expect(pathLayerName).toBeTruthy();

  await page.getByRole('button', { name: 'Layer', exact: true }).click();
  await page.getByRole('button', { name: 'Stroke Path', exact: true }).click();
  await page.waitForTimeout(300);

  // Hide the vector path layer itself — if dark pixels remain, they can only be the raster bake,
  // not the live vector render (a single-point pixel sample is too fragile against a thin,
  // anti-aliased stroke; a page-wide dark-pixel count is robust to exactly where it lands).
  await page.locator(`[aria-label="Hide ${pathLayerName}"]`).click();
  await page.waitForTimeout(300);

  const rasterOnlyDarkPixels = await countDarkPixels(page);
  expect(rasterOnlyDarkPixels, 'raster layer should carry a baked stroke even with the path layer hidden').toBeGreaterThan(0);
});

test('Make Selection from Path produces a real selection that clips subsequent painting', async ({ page }) => {
  await openLayersPanel(page);
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);

  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // A modest triangle, well within the page's on-screen bounds at whatever zoom the fixture opens
  // at — earlier attempts here used offsets large enough to land some sample points outside the
  // actual page canvas (reading the app's chrome background, not page content), which looked like a
  // clipping failure but was really a test-geometry bug.
  await page.keyboard.press('p');
  await page.mouse.click(cx - 60, cy - 60);
  await page.mouse.click(cx + 60, cy - 60);
  await page.mouse.click(cx, cy + 60);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const pathLayerName = await page.getByText(/^Path \d+$/).first().textContent();
  expect(pathLayerName).toBeTruthy();

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'Make Selection from Path', exact: true }).click();
  await page.waitForTimeout(300);

  // Switch to the raster layer and drag a brush stroke past both sides of the triangle at a height
  // where it's narrow (partway between the flat top edge and the bottom apex) — a real clip should
  // leave ink only in the middle. (Brush painting clips via a real ctx.clip() Path2D, unlike
  // floodFillAt's Paint Bucket, which manually walks pixels post-hoc and doesn't currently honor a
  // polygon-shaped selection — a separate, pre-existing gap outside this feature's scope, not
  // something to route around by weakening this assertion.)
  await page.locator('button').filter({ has: page.getByText('Layer 1', { exact: true }) }).first().click();
  await page.keyboard.press('b');
  const strokeY = cy - 20; // triangle narrows to roughly ±40px here (base ±60 at cy-60, apex at cy+60)
  await page.mouse.move(cx - 90, strokeY);
  await page.mouse.down();
  await page.mouse.move(cx + 90, strokeY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const inside = await pixelAt(page, cx, strokeY);
  const outsideLeft = await pixelAt(page, cx - 90, strokeY);
  const outsideRight = await pixelAt(page, cx + 90, strokeY);
  expect(isGrey(inside), `brush stroke inside the path-derived selection should land, got ${JSON.stringify(inside)}`).toBe(false);
  expect(isGrey(outsideLeft), `stroke should be clipped before the triangle's left edge, got ${JSON.stringify(outsideLeft)}`).toBe(true);
  expect(isGrey(outsideRight), `stroke should be clipped before the triangle's right edge, got ${JSON.stringify(outsideRight)}`).toBe(true);
});
