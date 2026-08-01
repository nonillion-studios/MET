import { test, expect } from '@playwright/test';
import { openStudio, countDarkPixels } from './studioFixture';

/** Fix 7: while TypeR is armed and a text box is being dragged out, the current line previews
 *  semi-transparently inside it — real Konva pixels, not a DOM overlay, so a dark-pixel probe is
 *  the right tool (matches this repo's own e2e convention for anything Konva-only). */

test('TypeR preview renders while dragging, before the box is released', async ({ page }) => {
  await openStudio(page);

  const script = page.getByPlaceholder(/Paste a script, one line per bubble/);
  await script.fill('HELLO');

  const armButton = page.getByRole('button', { name: 'Arm placement' });
  await armButton.click();
  await expect(page.getByRole('button', { name: /Armed/ })).toBeVisible();

  const box = (await page.locator('canvas').first().boundingBox())!;
  const startX = box.x + box.width * 0.25, startY = box.y + box.height * 0.25;
  const endX = box.x + box.width * 0.75, endY = box.y + box.height * 0.45;

  const before = await countDarkPixels(page);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  // Mid-drag, before mouseup: the preview should already be rendering "HELLO" at partial opacity.
  await page.waitForTimeout(150);
  const midDrag = await countDarkPixels(page);
  expect(midDrag, `preview text should render mid-drag, before=${before} midDrag=${midDrag}`).toBeGreaterThan(before);

  await page.mouse.up();
  await page.waitForTimeout(400);

  // Placing the line auto-advances (Behavior A, already real) — the line list shows it placed and
  // the script textarea's own line count reads "All lines placed" for a single-line script.
  await expect(page.getByText('All lines placed.')).toBeVisible({ timeout: 5_000 });
});

test('TypeR preview never appears when TypeR is not armed', async ({ page }) => {
  await openStudio(page);
  const script = page.getByPlaceholder(/Paste a script, one line per bubble/);
  await script.fill('HELLO');
  // Deliberately not arming — a plain drag with the Text tool active but TypeR unarmed should show
  // only the existing dashed-box + W×H readout, no preview glyphs.
  await page.keyboard.press('t');

  const box = (await page.locator('canvas').first().boundingBox())!;
  const before = await countDarkPixels(page);
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.45, { steps: 10 });
  await page.waitForTimeout(150);
  const midDrag = await countDarkPixels(page);
  await page.mouse.up();

  // The dashed box itself is a thin light-blue stroke, not dark — dark-pixel count should stay flat.
  expect(Math.abs(midDrag - before), `unarmed drag should show no preview glyphs, before=${before} midDrag=${midDrag}`).toBeLessThan(30);
});
