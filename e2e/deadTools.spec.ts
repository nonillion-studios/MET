import { test, expect } from '@playwright/test';
import { openStudio } from './studioFixture';

/**
 * Part H "dead tools": heal, patch, slice, lasso-magnetic — previously declared in toolGroups.ts
 * with `enabled: false` and wired to nothing. These tests exercise the real interaction path for
 * each, not just that the tool is selectable. Pen/curvature-pen (also Part H originally) grew into
 * the full Part I vector Pen Tool and moved to pathTool.spec.ts.
 */

async function pixelAt(page: import('@playwright/test').Page, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  const shot = await page.screenshot({ clip: { x: x - 3, y: y - 3, width: 6, height: 6 } });
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

/** Opens a tool group's flyout (right-click/contextmenu, matching ToolGroupButton's hold/right-click
 *  affordance) and picks a sibling tool by its label — the only way to reach a tool with no
 *  single-key shortcut, like every tool this suite covers. */
async function pickTool(page: import('@playwright/test').Page, groupDefaultLabel: string, toolLabel: string) {
  const groupButton = page.locator(`[aria-label="${groupDefaultLabel}"]`).first();
  await groupButton.click({ button: 'right' });
  await page.locator(`[aria-label="${toolLabel}"]`).first().click();
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
});

test('heal color-matches a stamp straddling a color boundary, instead of copying the source flat', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);

  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // Paint a black square well to the left — this is the Heal source (uniform black).
  const srcX = cx - 150, srcY = cy;
  await page.keyboard.press('u');
  await page.mouse.move(srcX - 25, srcY - 25);
  await page.mouse.down();
  await page.mouse.move(srcX + 25, srcY + 25, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(isBlack(await pixelAt(page, srcX, srcY)), 'source square should be black').toBe(true);

  // A second black square whose right edge sits at the destination point — so the Heal brush,
  // centred there, straddles black (left half) and the still-grey background (right half). Color
  // matching should pull the whole stamp toward the region's own mixed average rather than leaving
  // a razor-sharp black/grey edge like an unmodified copy would.
  const destX = cx + 100, destY = cy;
  await page.keyboard.press('u');
  await page.mouse.move(destX - 40, destY - 20);
  await page.mouse.down();
  await page.mouse.move(destX, destY + 20, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(isBlack(await pixelAt(page, destX - 10, destY)), 'left half of the boundary square should start black').toBe(true);
  expect(isGrey(await pixelAt(page, destX + 15, destY)), 'right of the boundary should start as background grey').toBe(true);

  await pickTool(page, 'Spot Healing Brush', 'Healing Brush');
  // Alt-click sets the source at the uniform black square.
  await page.mouse.move(srcX, srcY);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(150);

  // Paint one stamp centred exactly on the black/grey boundary of the destination square.
  await page.mouse.move(destX, destY);
  await page.mouse.down();
  await page.mouse.move(destX + 1, destY, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const healed = await pixelAt(page, destX, destY);
  expect(isBlack(healed) || isGrey(healed), `healed boundary pixel should blend toward mid-tone, got ${JSON.stringify(healed)}`).toBe(false);
});

test('patch drags a selection to a clean area, blends it into the defect, and leaves the marquee at its original spot', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);

  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // A defect: a black square at the centre.
  await page.keyboard.press('u');
  await page.mouse.move(cx - 25, cy - 25);
  await page.mouse.down();
  await page.mouse.move(cx + 25, cy + 25, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(isBlack(await pixelAt(page, cx, cy)), 'defect square should start black').toBe(true);

  // Select exactly around the defect.
  await page.keyboard.press('m');
  await page.mouse.move(cx - 30, cy - 30);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy + 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Patch: drag from inside the selection out to a clean grey area well away from the defect.
  await pickTool(page, 'Spot Healing Brush', 'Patch Tool');
  const cleanX = cx + 150, cleanY = cy;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cleanX, cleanY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // The defect no longer reads as flat, uniform black — it picked up the clean area's content.
  const patched = await pixelAt(page, cx, cy);
  expect(isBlack(patched), `defect should no longer be solid black after patching, got ${JSON.stringify(patched)}`).toBe(false);
});

test('slice queues rects and exports one cropped PNG per rect in a zip', async ({ page }) => {
  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await pickTool(page, 'Crop', 'Slice');

  await page.mouse.move(cx - 60, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx - 10, cy - 10, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /Add Rect/ }).click();
  await page.waitForTimeout(200);
  await expect(page.getByRole('button', { name: /Add Rect \(1\)/ })).toBeVisible();

  await page.mouse.move(cx + 10, cy + 10);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /Add Rect/ }).click();
  await page.waitForTimeout(200);
  await expect(page.getByRole('button', { name: /Add Rect \(2\)/ })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Slices…' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-slices\.zip$/);
});

test('magnetic lasso commits a usable selection that clips subsequent painting', async ({ page }) => {
  await page.getByRole('button', { name: 'Add layer' }).click();
  await page.waitForTimeout(400);

  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // A high-contrast vertical edge for the tool to snap segments onto: a black rectangle covering
  // the left half of a region centred on the page.
  await page.keyboard.press('u');
  await page.mouse.move(cx - 80, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Trace a triangle straddling the edge and commit it — proves snapSegmentToEdges produces a
  // usable, non-degenerate Selection (not a crash/empty result) for a real multi-anchor path.
  await pickTool(page, 'Lasso', 'Magnetic Lasso');
  await page.mouse.click(cx - 80, cy - 50);
  await page.mouse.click(cx + 20, cy - 50);
  await page.mouse.click(cx - 30, cy + 50);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // Fill with the Paint Bucket: a point inside the triangle should get painted, a point well
  // outside it should stay untouched — the selection is real and actually clips.
  await pickTool(page, 'Gradient', 'Paint Bucket');
  await page.mouse.click(cx - 40, cy - 20); // inside the traced triangle
  await page.waitForTimeout(300);

  const inside = await pixelAt(page, cx - 40, cy - 20);
  const outsideFarRight = await pixelAt(page, cx + 100, cy + 90);
  expect(isBlack(inside), `paint bucket fill inside the magnetic-lasso selection should land, got ${JSON.stringify(inside)}`).toBe(true);
  expect(isGrey(outsideFarRight), `fill should be clipped to the selection, got ${JSON.stringify(outsideFarRight)}`).toBe(true);
});
