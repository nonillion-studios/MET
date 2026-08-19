import { test, expect, type Page } from '@playwright/test';
import { openStudio, readStudioStore, typeIntoTextLayer } from './studioFixture';

/**
 * Overflow feedback on area (fixed-height) text boxes: the box's own frame border turns red the
 * moment wrapped content exceeds the fixed height and is actually being clipped at the bottom
 * edge, rather than a separate floating indicator icon. Double-clicking a resize handle while the
 * box is overflowing auto-fits its height to content instead of the usual width-fit (undoable).
 * See TextLayerNode.tsx / textLayout.ts / Studio.tsx's handleAutoFitTextHeight /
 * StudioCanvas.tsx's onHandleDblClick.
 */

interface StoredTextLayer {
  type: string;
  text?: { x: number; y: number; width: number; fontSize: number; fixedHeight?: number; autoWidth: boolean; content: string };
}

async function findTextLayers(page: Page): Promise<StoredTextLayer[]> {
  const store = await readStudioStore(page);
  if (!store) return [];
  const layersByPage = JSON.parse(store.layersJson) as Record<string, StoredTextLayer[]>;
  return Object.values(layersByPage).flat().filter(l => l.type === 'text');
}

/** Polls until the just-created text layer has a persisted fixedHeight, then returns it. Also
 *  waits out the autosave debounce (Studio.tsx schedules it ~1.2s after the last change), so
 *  callers get a value that's actually landed in IndexedDB, not a stale pre-creation read. */
async function waitForFixedHeight(page: Page): Promise<number> {
  await expect.poll(async () => (await findTextLayers(page))[0]?.text?.fixedHeight, { timeout: 15_000 }).toBeGreaterThan(0);
  return (await findTextLayers(page))[0].text!.fixedHeight!;
}

/** How many newline-separated short lines it takes to push naturalHeight (fontSize * lineHeight
 *  per line, textLayout.ts) past a box's persisted fixedHeight (image-space px, queried back from
 *  the store rather than assumed — the drag's screen-space size maps to an image-space fixedHeight
 *  through the Stage's current zoom, which the test doesn't otherwise know). */
function linesToOverflow(fixedHeight: number, fontSize = 28, lineHeight = 1.15): number {
  return Math.ceil(fixedHeight / (fontSize * lineHeight)) + 3;
}

/** Counts pixels matching the overflow border's red stroke (#e53e3e) anywhere on the stage — a
 *  distinctive color the fixture's flat grey page (#808080) and default black text never produce,
 *  so presence/absence is a reliable global signal without knowing exact screen coordinates
 *  (mirrors studioFixture.ts's countDarkPixels, scoped to `.konvajs-content canvas`). */
async function countRedBorderPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0;
    for (const c of Array.from(document.querySelectorAll('.konvajs-content canvas'))) {
      const canvas = c as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0 || canvas.height === 0) continue;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a <= 128) continue;
        if (r > 200 && r < 245 && g > 40 && g < 90 && b > 40 && b < 90) n += 1;
      }
    }
    return n;
  });
}

/** Counts near-black pixels within a small *screen*-space region (a screenshot clip, decoded back
 *  into a canvas) — for positional assertions (is content actually clipped past the frame?) that
 *  need to check a specific spot rather than the whole stage. A per-pixel count, not an average:
 *  averaging a small feature over a wider patch dilutes it below any sane threshold once the
 *  surrounding background contributes most of the patch's area. */
async function countDarkPixelsInRegion(page: Page, x: number, y: number, width: number, height: number): Promise<number> {
  const shot = await page.screenshot({ clip: { x, y, width, height } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = `data:image/png;base64,${b64}`; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a <= 128) continue;
      if (r < 64 && g < 64 && b < 64) n += 1;
    }
    return n;
  }, shot.toString('base64'));
}

/** Finds a Transformer resize handle empirically by scanning for near-white pixel clusters
 *  (Konva's default anchor style) within a search region, and returning the one with the largest
 *  (x+y) — i.e. bottom-right-most. Requires the layer to already be selected with the Move/Select
 *  tool active, or no handles are rendered at all. Returns null if none found. */
async function findBottomRightHandle(page: Page, region: { x: number; y: number; width: number; height: number }): Promise<{ x: number; y: number } | null> {
  const shot = await page.screenshot({ clip: region });
  const centroid = await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = `data:image/png;base64,${b64}`; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let bestScore = -Infinity, bestX = -1, bestY = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a > 200 && r > 245 && g > 245 && b > 245) {
          const score = x + y;
          if (score > bestScore) { bestScore = score; bestX = x; bestY = y; }
        }
      }
    }
    return bestX >= 0 ? { x: bestX, y: bestY } : null;
  }, shot.toString('base64'));
  if (!centroid) return null;
  return { x: region.x + centroid.x, y: region.y + centroid.y };
}

/**
 * A screen point guaranteed to land on the rendered page, not the dark padding around it.
 * `fitToScreen` centers the page within the Stage's container (confirmed by
 * typerBubbleDetect.spec.ts: "the box's center is the image's center"), so the container's own
 * center is reliably on-page at any zoom — unlike a fixed offset from the container's corner,
 * which can land in the surrounding padding once the page is smaller than the container. */
async function getPageCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.locator('canvas').first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags out an area (box) text layer via the Text tool, at a known origin *inside the rendered
 *  page* — a drag, not a click, so it gets a fixedHeight (StudioCanvas.tsx's onAddTextLayer
 *  boxWidth/boxHeight path). Fresh text layers auto-enter edit mode (StudioCanvas.tsx), so the
 *  caller can type straight away. Returns the drag's screen origin. */
async function dragCreateAreaText(page: Page, w: number, h: number): Promise<{ x0: number; y0: number }> {
  await page.keyboard.press('t');
  const center = await getPageCenter(page);
  const x0 = center.x - 40, y0 = center.y - 60;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + w, y0 + h, { steps: 8 });
  await page.mouse.up();
  return { x0, y0 };
}

/** Switches to the Move/Select tool — the Text tool stays armed after creating a layer (by
 *  design, for placing several boxes in a row), so a click/drag on the canvas while it's still
 *  active creates MORE text layers instead of selecting/resizing the existing one. Resize-handle
 *  tests need this before a Transformer handle will even render. */
async function switchToMoveTool(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.waitForTimeout(200);
}

/** Deselects (clicking empty canvas, well clear of where every test's box is created). */
async function deselect(page: Page): Promise<void> {
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.click(box.x + box.width - 10, box.y + box.height - 10);
  await page.waitForTimeout(150);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await openStudio(page);
  // A short settle after the Studio mounts — the canvas element is visible (openStudio already
  // waits for that) slightly before the Stage's fitToScreen/pointer handling has fully settled;
  // without this, a tool keypress immediately followed by a mouse gesture can occasionally land
  // before the Stage is ready to act on it, and no layer gets created at all.
  await page.waitForTimeout(400);
});

test('short content in a roomy box shows no red overflow border', async ({ page }) => {
  await dragCreateAreaText(page, 200, 150);
  await typeIntoTextLayer(page, 'A short line');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(await countRedBorderPixels(page)).toBe(0);
});

test('typing past the frame height turns the border red, deleting back down clears it', async ({ page }) => {
  const { x0, y0 } = await dragCreateAreaText(page, 160, 40);
  const fh = await waitForFixedHeight(page);
  const lines = Array.from({ length: linesToOverflow(fh) }, (_, i) => `Line ${i}`);

  await typeIntoTextLayer(page, lines.join('\n'));
  await page.keyboard.press('Escape');
  await expect.poll(() => countRedBorderPixels(page), { timeout: 15_000 }).toBeGreaterThan(0);

  // Re-enter editing (double-click the box interior) and clear it back down to something short.
  await page.mouse.dblclick(x0 + 80, y0 + 15);
  const textarea = page.locator('textarea:not(#swal2-textarea)').first();
  await textarea.waitFor({ state: 'visible' });
  await textarea.click();
  await textarea.selectText();
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Hi');
  await page.keyboard.press('Escape');

  await expect.poll(() => countRedBorderPixels(page), { timeout: 15_000 }).toBe(0);
});

test('increasing font size past the threshold turns the border red; decreasing clears it', async ({ page }) => {
  const { x0, y0 } = await dragCreateAreaText(page, 220, 60);
  await typeIntoTextLayer(page, 'One line of text');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(await countRedBorderPixels(page)).toBe(0);

  // The layer is already active (Add Text Layer sets it). Ctrl+Period/Comma step its font size —
  // grow it in a handful of steps, well beyond what a single short line at the original size
  // needed to fit the frame.
  await page.mouse.click(x0 + 80, y0 + 15);
  for (let i = 0; i < 12; i++) await page.keyboard.press('Control+Period');
  await expect.poll(() => countRedBorderPixels(page), { timeout: 15_000 }).toBeGreaterThan(0);

  for (let i = 0; i < 12; i++) await page.keyboard.press('Control+Comma');
  await expect.poll(() => countRedBorderPixels(page), { timeout: 15_000 }).toBe(0);
});

test('double-clicking a resize handle auto-fits the frame height when overflowing, undoably', async ({ page }) => {
  const { x0, y0 } = await dragCreateAreaText(page, 160, 40);
  const fh = await waitForFixedHeight(page);
  const lines = Array.from({ length: linesToOverflow(fh) }, (_, i) => `Line ${i}`);
  await typeIntoTextLayer(page, lines.join('\n'));
  await page.keyboard.press('Escape');
  await expect.poll(() => countRedBorderPixels(page), { timeout: 15_000 }).toBeGreaterThan(0);

  await switchToMoveTool(page);
  await page.mouse.click(x0 + 20, y0 + 10);
  await page.waitForTimeout(500);

  const handle = await findBottomRightHandle(page, { x: x0 - 20, y: y0 - 20, width: 200, height: 100 });
  expect(handle).not.toBeNull();
  await page.mouse.dblclick(handle!.x, handle!.y);

  await expect.poll(async () => (await findTextLayers(page))[0]?.text?.fixedHeight, { timeout: 15_000 })
    .toBeGreaterThan(fh + 5);
  await expect.poll(() => countRedBorderPixels(page), { timeout: 15_000 }).toBe(0);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await findTextLayers(page))[0]?.text?.fixedHeight, { timeout: 15_000 })
    .toBeCloseTo(fh, 0);
  await expect.poll(() => countRedBorderPixels(page), { timeout: 15_000 }).toBeGreaterThan(0);
});

test('point text never shows a red overflow border, however long the content', async ({ page }) => {
  await page.keyboard.press('t');
  const center = await getPageCenter(page);
  await page.mouse.click(center.x, center.y);
  const longContent = Array.from({ length: 30 }, (_, i) => `Line number ${i} of quite a lot of point text`).join('\n');
  // Not typeIntoTextLayer here: this app has more than one textarea in the DOM (e.g. the TypeR
  // panel's script box), and `textarea:not(#swal2-textarea)` isn't specific enough to always pick
  // the text-layer editing overlay over one of those. `[dir]` is unique to the editing overlay
  // (StudioCanvas.tsx sets it to reflect RTL/LTR; TypeR's own textarea has no such attribute).
  const textarea = page.locator('textarea[dir]').first();
  await textarea.waitFor({ state: 'visible' });
  await textarea.click();
  await textarea.pressSequentially(longContent);
  await page.keyboard.press('Escape');

  await expect.poll(async () => (await findTextLayers(page))[0]?.text?.content, { timeout: 15_000 }).toBeTruthy();
  const layers = await findTextLayers(page);
  expect(layers[0].text!.autoWidth).toBe(true);
  expect(layers[0].text!.fixedHeight).toBeUndefined();
  expect(await countRedBorderPixels(page)).toBe(0);
});

test('overflowing content is visually clipped at the frame bottom, but not destroyed', async ({ page }) => {
  const { x0, y0 } = await dragCreateAreaText(page, 160, 40);
  const fh = await waitForFixedHeight(page);
  const lines = Array.from({ length: linesToOverflow(fh) + 5 }, () => 'XXXXXXXXXX');
  await typeIntoTextLayer(page, lines.join('\n'));
  await page.keyboard.press('Escape');
  await expect.poll(() => countRedBorderPixels(page), { timeout: 15_000 }).toBeGreaterThan(0);
  await deselect(page);

  // Well below the box's bottom edge (y0 + h), where overflow content used to paint — dark default
  // (#000000) text on the fixture's flat grey (#808080) page. The frame is a real clip boundary
  // (a Konva `clip` on the glyph Group in TextLayerNode.tsx), flagged by the red border above, so
  // none of the "XXXXXXXXXX" lines past the frame paint into this band anymore.
  const darkPixels = await countDarkPixelsInRegion(page, x0, y0 + 40 + 15, 160, 60);
  expect(darkPixels).toBe(0);

  // But the content itself is untouched, not deleted — re-entering selection and growing the box
  // taller (via a resize handle's double-click auto-fit) reveals the same overflow text again.
  await switchToMoveTool(page);
  await page.mouse.click(x0 + 20, y0 + 10);
  await page.waitForTimeout(500);
  const handle = await findBottomRightHandle(page, { x: x0 - 20, y: y0 - 20, width: 200, height: 100 });
  expect(handle).not.toBeNull();
  await page.mouse.dblclick(handle!.x, handle!.y);

  await expect.poll(async () => (await findTextLayers(page))[0]?.text?.fixedHeight, { timeout: 15_000 })
    .toBeGreaterThan(fh + 5);
  await expect.poll(() => countRedBorderPixels(page), { timeout: 15_000 }).toBe(0);
  await deselect(page);
  const darkPixelsAfterGrow = await countDarkPixelsInRegion(page, x0, y0 + 40 + 15, 160, 60);
  expect(darkPixelsAfterGrow).toBeGreaterThan(0);
});
