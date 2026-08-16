import { test, expect, type Page } from '@playwright/test';
import { seedChapter, navigateToStudio, CHAPTER_ID } from './studioFixture';

/**
 * TextLayerData.autoFitFontSize (textLayout.ts's fitFontSizeToBox): shrinks a box (fixed-height)
 * text layer's effective font size so overflowing content fits inside the frame, without touching
 * the stored `fontSize` ceiling.
 *
 * Seeds the text layer directly into IndexedDB (studio_<chapterId>) rather than driving it through
 * the Text panel's UI controls (the pattern textOverflow.spec.ts and other specs otherwise use) —
 * driving ANY control in the Text panel while a text layer is selected currently crashes the whole
 * app with a React error #185 ("Cannot update a component while rendering a different component"),
 * confirmed pre-existing on main (reproduces identically with none of this session's changes
 * applied) and unrelated to autoFitFontSize specifically — clicking the pre-existing Bold button
 * reproduces it too. Out of scope to fix here; flagged separately. Seeding sidesteps that crash
 * entirely while still exercising the real thing under test: layoutText's auto-fit resolution
 * feeding into TextLayerNode's real Konva render in a real browser.
 */

const OVERFLOWING_CONTENT = 'Line one\nLine two\nLine three\nLine four\nLine five';

interface SeedTextLayerOpts {
  autoFitFontSize?: boolean;
  fontSize?: number;
  fixedHeight?: number;
}

async function seedTextLayer(page: Page, opts: SeedTextLayerOpts = {}): Promise<void> {
  await page.evaluate(({ chapterId, content, opts }) => {
    const get = (key: string) => new Promise<any>((resolve, reject) => {
      const open = indexedDB.open('keyval-store');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const req = open.result.transaction('keyval', 'readonly').objectStore('keyval').get(key);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      };
    });
    const put = (key: string, value: unknown) => new Promise<void>((resolve, reject) => {
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

    return (async () => {
      const textLayer = {
        id: 'e2e-autofit-layer',
        type: 'text',
        name: 'Auto-fit Test',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        text: {
          content,
          x: 20, y: 20, width: 160,
          fontFamily: 'Arial',
          fontSize: opts.fontSize ?? 40,
          color: '#000000',
          align: 'left',
          bold: false, italic: false,
          lineHeight: 1.15,
          strokeColor: '#ffffff', strokeWidth: 0,
          rotation: 0,
          autoWidth: false,
          fixedHeight: opts.fixedHeight ?? 60,
          autoFitFontSize: opts.autoFitFontSize ?? false,
          letterSpacing: 0,
          shadow: { enabled: false, color: '#000000', blur: 6, offsetX: 0, offsetY: 2 },
          gradient: { enabled: false, from: '#000000', to: '#ffffff', angle: 0 },
          runs: [],
          status: 'draft',
          comment: '',
        },
      };
      const data = {
        schemaVersion: 9,
        layersByPage: { 'e2e-page-1': [textLayer] },
        typerScript: '', typerStyles: [], typerFolders: [],
        ignoreLinePrefixes: ['##'], ignoreTags: [], defaultStyleId: null,
        updatedAt: new Date().toISOString(),
      };
      await put(`studio_${chapterId}`, data);
    })();
  }, { chapterId: CHAPTER_ID, content: OVERFLOWING_CONTENT, opts });
}

/** Same fill-color probe as textOverflow.spec.ts's countIndicatorFillPixels. */
async function countIndicatorFillPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0;
    for (const c of Array.from(document.querySelectorAll('.konvajs-content canvas'))) {
      const canvas = c as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0 || canvas.height === 0) continue;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 128 && data[i] > 240 && data[i + 1] > 235 && data[i + 2] > 200 && data[i + 2] < 245) n += 1;
      }
    }
    return n;
  });
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw new Error(`Uncaught page error: ${e.message}`); });
});

test('without autoFitFontSize, overflowing content shows the ⊞ indicator', async ({ page }) => {
  await seedChapter(page);
  await seedTextLayer(page, { autoFitFontSize: false });
  await page.reload();
  await navigateToStudio(page);
  await expect.poll(() => countIndicatorFillPixels(page), { timeout: 15_000 }).toBeGreaterThan(15);
});

test('with autoFitFontSize, the same overflowing content shrinks to fit — no indicator', async ({ page }) => {
  await seedChapter(page);
  await seedTextLayer(page, { autoFitFontSize: true });
  await page.reload();
  await navigateToStudio(page);
  // Same content/frame as the control test above; only the flag differs.
  await page.waitForTimeout(500);
  expect(await countIndicatorFillPixels(page)).toBe(0);
});
