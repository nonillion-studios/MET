import { test, expect, type Page } from '@playwright/test';
import { CHAPTER_ID, navigateToStudio, readStudioStore } from './studioFixture';

/**
 * TypeR's Auto-detect-bubble placement and the text-size-step-with-recenter shortcut — both new
 * ports of the real ScanR/TypeR extension's behavior (see studioTypes.ts's parseTyperScript and
 * Studio.tsx's handleAddTextLayer/handleTextSizeStep).
 *
 * Auto-detect-bubble needs a page background with real contrast to flood-fill against — the shared
 * fixture's flat #808080 page is deliberately uniform (for the dark-pixel probe elsewhere) and
 * would flood-fill almost the whole canvas, so this spec seeds its own two-tone page directly
 * rather than extending the shared fixture.
 */

const PAGE_W = 400;
const PAGE_H = 600;
// A light bubble centered in the page, on a dark background well below the light-flood-fill
// threshold — small enough relative to the page that the flood fill's "not basically the whole
// canvas" guard doesn't reject it.
const BUBBLE = { x: 120, y: 250, width: 160, height: 100 };

async function seedBubblePage(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify({
      access_token: 'e2e-fake-access-token', token_type: 'bearer', expires_in: 3600,
      expires_at: oneHourFromNow, refresh_token: 'e2e-fake-refresh-token',
      user: {
        id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated',
        email: 'e2e@test.local', app_metadata: {}, user_metadata: { name: 'E2E User', avatar: '' },
        created_at: new Date().toISOString(),
      },
    }));
  });

  const dataUrl = await page.evaluate(({ w, h, bubble }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#202020';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(bubble.x, bubble.y, bubble.width, bubble.height);
    return c.toDataURL('image/png');
  }, { w: PAGE_W, h: PAGE_H, bubble: BUBBLE });

  await page.evaluate(async ({ dataUrl, chapterId, w, h }) => {
    const put = (key: string, value: unknown) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('keyval-store');
        open.onupgradeneeded = () => open.result.createObjectStore('keyval');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('keyval', 'readwrite');
          tx.objectStore('keyval').put(value, key);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });

    const image = { id: 'img-1', filename: 'page-001.png', dataUrl, mimeType: 'image/png', width: w, height: h };
    await put('workspaces_library', [{
      id: 'e2e-ws', name: 'E2E', description: '', coverUrl: '',
      mangas: [{
        id: 'e2e-manga', title: 'E2E Manga', type: 'manga', coverUrl: '', description: '',
        volumes: [{
          id: 'e2e-vol', name: 'Vol 1', coverUrl: '',
          chapters: [{
            id: chapterId, name: 'Ch 1', coverUrl: '',
            pages: [{ id: 'e2e-page-1', order: 0, original: image, cleaned: null }],
          }],
        }],
      }],
    }]);
    await put(`studio_${chapterId}`, undefined);
  }, { dataUrl, chapterId: CHAPTER_ID, w: PAGE_W, h: PAGE_H });

  await page.reload();
  await navigateToStudio(page);
}

interface StoredTextLayer {
  type: string;
  text?: { x: number; y: number; width: number; fontSize: number };
}

async function findTextLayers(page: Page): Promise<StoredTextLayer[]> {
  const store = await readStudioStore(page);
  if (!store) return [];
  const layersByPage = JSON.parse(store.layersJson) as Record<string, StoredTextLayer[]>;
  return Object.values(layersByPage).flat().filter(l => l.type === 'text');
}

test('TypeR auto-detect-bubble sizes/centers placement to the detected bubble, not the raw click', async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await seedBubblePage(page);

  await page.getByRole('tab', { name: 'TypeR' }).or(page.getByText('TypeR', { exact: true })).first().click();
  await page.getByPlaceholder(/Paste a script/).fill('Hello bubble');
  await page.getByRole('button', { name: 'Auto-detect bubble' }).click();
  await page.getByRole('button', { name: /Arm placement/ }).click();

  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  // fitToScreen centers the page in the container, so the box's center is the image's center,
  // which is also where the bubble was drawn.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect.poll(async () => (await findTextLayers(page)).length, { timeout: 15_000 }).toBe(1);
  const [layer] = await findTextLayers(page);
  expect(layer.text).toBeTruthy();
  const centerX = layer.text!.x + layer.text!.width / 2;
  const bubbleCenterX = BUBBLE.x + BUBBLE.width / 2;
  // Generous tolerance: bubble detection runs on a downscaled sample, so bounds aren't pixel-exact.
  expect(Math.abs(centerX - bubbleCenterX)).toBeLessThan(40);
  // A raw, undetected click would leave the layer's default (undefined-width -> 240) box — proof
  // the detected bubble's ~160px width actually drove the sizing, not the old fallback constant.
  expect(layer.text!.width).toBeLessThan(220);
});

test('Ctrl+. / Ctrl+, steps the active text layer\'s font size and re-centers it', async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
  await seedBubblePage(page);

  await page.keyboard.press('t');
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type('hello');
  await page.keyboard.press('Escape');

  await expect.poll(async () => (await findTextLayers(page))[0]?.text?.fontSize, { timeout: 15_000 }).toBe(28);
  const before = (await findTextLayers(page))[0].text!;

  await page.keyboard.press('Control+Period');
  await expect.poll(async () => (await findTextLayers(page))[0]?.text?.fontSize, { timeout: 15_000 }).toBe(30);
  const afterIncrease = (await findTextLayers(page))[0].text!;
  // Growing the box should shift x left to keep the box centered, not leave it pinned at the old
  // top-left corner.
  expect(afterIncrease.x).toBeLessThan(before.x);

  await page.keyboard.press('Control+Comma');
  await expect.poll(async () => (await findTextLayers(page))[0]?.text?.fontSize, { timeout: 15_000 }).toBe(28);
});
