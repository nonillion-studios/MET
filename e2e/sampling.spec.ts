import { test, expect } from '@playwright/test';
import { openStudio } from './studioFixture';

/**
 * Fix 1 (layer sampling) + Fix 2 (clone crosshair sync) regression coverage.
 *
 * Both bugs are about pixels the DOM can't see (canvas content, a Konva stroke) or a live drag
 * gesture, so these need a real browser, not a unit test — see CLAUDE.md's e2e guidance.
 */

async function paintRedStroke(page: import('@playwright/test').Page, x: number, y: number) {
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 20, box.y + y, { steps: 6 });
  await page.mouse.up();
}

test('Eyedropper "All Layers" sample mode reads a raster layer above the background', async ({ page }) => {
  await openStudio(page);

  // Seeded background is flat #808080. Add a raster layer and paint a red stroke on it.
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  await page.getByRole('button', { name: 'Brush', exact: true }).click();

  // Set the foreground swatch to red via the color panel's Hex field.
  const hexInput = page.locator('label:has-text("Hex") input');
  await hexInput.fill('ff0000');
  await hexInput.press('Enter');

  await paintRedStroke(page, 150, 200);

  // Eyedropper, default Sample mode is "All Layers" — should read the red stroke, not the grey bg,
  // which sets the foreground swatch — read back via the same Hex field.
  await page.getByRole('button', { name: 'Eyedropper', exact: true }).click();
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.click(box.x + 150, box.y + 200);

  await expect(hexInput).toHaveValue(/^#ff0000$/i, { timeout: 5_000 });
});

test('Clone Stamp crosshair tracks the brush at a fixed offset during a stroke', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  await page.getByRole('button', { name: 'Clone Stamp', exact: true }).click();

  const box = (await page.locator('canvas').first().boundingBox())!;
  const sourceX = box.x + 80, sourceY = box.y + 80;
  const startX = box.x + 200, startY = box.y + 200;

  await page.mouse.move(sourceX, sourceY);
  await page.keyboard.down('Alt');
  await page.mouse.down({ button: 'left' });
  await page.mouse.up();
  await page.keyboard.up('Alt');

  // Alt+click sets the source; a plain click-drag elsewhere paints from it at a fixed offset.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY, { steps: 1 });

  const crosshair = page.locator('svg g:has(circle[r="6"])').first();
  await expect(crosshair).toBeVisible({ timeout: 5_000 });
  const t1 = await crosshair.getAttribute('transform');

  await page.mouse.move(startX + 60, startY + 40, { steps: 8 });
  const t2 = await crosshair.getAttribute('transform');
  await page.mouse.up();

  expect(t1).not.toBeNull();
  expect(t2).not.toBeNull();
  const parse = (t: string) => {
    const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(t);
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
  };
  const p1 = parse(t1!);
  const p2 = parse(t2!);
  expect(p1).not.toBeNull();
  expect(p2).not.toBeNull();
  // The crosshair must have moved along with the brush — a frozen crosshair (the pre-fix bug)
  // would leave t1 === t2.
  const dx = Math.abs((p2!.x - p1!.x) - 60);
  const dy = Math.abs((p2!.y - p1!.y) - 40);
  expect(dx).toBeLessThan(5);
  expect(dy).toBeLessThan(5);
});
