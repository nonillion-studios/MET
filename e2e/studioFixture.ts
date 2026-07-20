import { expect, type Page } from '@playwright/test';

/**
 * Seeds a one-page chapter straight into IndexedDB and opens it in the Studio.
 *
 * Going through the real import UI would mean driving a file picker and the pairing flow for every
 * test; the library store is a plain `workspaces_library` key, so writing it directly is both
 * faster and far less brittle. The Studio itself is still exercised for real — only the fixture
 * setup is shortcut.
 */

export const CHAPTER_ID = 'e2e-chapter';
const PAGE_W = 400;
const PAGE_H = 600;

/** A solid mid-grey PNG — flat colour makes a rendering regression obvious in a pixel probe. */
async function makePageDataUrl(page: Page): Promise<string> {
  return page.evaluate(({ w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    return c.toDataURL('image/png');
  }, { w: PAGE_W, h: PAGE_H });
}

/**
 * Fakes a signed-in Supabase session in localStorage.
 *
 * `AuthGate` wraps the entire app — Library and Studio included — and `useTeamAuth` gates on
 * `supabase.auth.getSession()`, which reads from localStorage. Seeding that key is what lets these
 * tests reach the Studio at all without a live Supabase project. `syncProfile`'s follow-up network
 * call fails and is swallowed by its own catch, which is fine: nothing under test reads the profile.
 */
async function seedSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600;
    // supabase-js derives its storage key from the project host: http://localhost:54321 -> "localhost".
    localStorage.setItem('sb-localhost-auth-token', JSON.stringify({
      access_token: 'e2e-fake-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: oneHourFromNow,
      refresh_token: 'e2e-fake-refresh-token',
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'e2e@test.local',
        app_metadata: {},
        user_metadata: { name: 'E2E User', avatar: '' },
        created_at: new Date().toISOString(),
      },
    }));
  });
}

export async function seedChapter(page: Page): Promise<void> {
  await page.goto('/');
  await seedSession(page);
  const dataUrl = await makePageDataUrl(page);

  await page.evaluate(async ({ dataUrl, chapterId, w, h }) => {
    // idb-keyval's default store: database "keyval-store", object store "keyval".
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
    // Start every run from a clean layer stack.
    await put(`studio_${chapterId}`, undefined);
  }, { dataUrl, chapterId: CHAPTER_ID, w: PAGE_W, h: PAGE_H });
}

/**
 * Counts near-black pixels on the Konva stage.
 *
 * The seeded page is flat #808080 and the default foreground is #000000, so "is there a brush
 * stroke on screen?" reduces to "are there dark pixels?".
 *
 * Scoped to `.konvajs-content` — Konva's stage wrapper — and NOT to every canvas on the page. The
 * Brushes panel renders its preset thumbnails with the real engine, in black, onto their own
 * canvases; counting those swamps the signal and the probe reports "painted" no matter what the
 * stage shows. Summing across whatever canvases the stage owns keeps this valid across the
 * layer-collapse refactor, which changes how many it renders into.
 */
export async function countDarkPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    let dark = 0;
    for (const c of Array.from(document.querySelectorAll('.konvajs-content canvas'))) {
      const canvas = c as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0 || canvas.height === 0) continue;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 128 && data[i] < 64 && data[i + 1] < 64 && data[i + 2] < 64) dark += 1;
      }
    }
    return dark;
  });
}

/**
 * Average RGB of a small patch at the centre of the rendered page.
 *
 * Goes through a real screenshot rather than reading canvas backing stores directly. That matters:
 * Konva hides a Layer by setting `display:none` on its canvas but leaves the stale pixels in place,
 * so compositing the backing stores by hand reports hidden layers as visible. A screenshot is the
 * browser's own compositor output, which is the thing under test.
 */
export async function sampleStageColor(page: Page): Promise<{ r: number; g: number; b: number }> {
  const stage = page.locator('.konvajs-content').first();
  const box = (await stage.boundingBox())!;
  const patch = 24;
  const shot = await page.screenshot({
    clip: { x: box.x + box.width / 2 - patch / 2, y: box.y + box.height / 2 - patch / 2, width: patch, height: patch },
  });

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

/**
 * Reads the persisted studio data for the seeded chapter, or null before the first autosave.
 *
 * Autosave is debounced, so poll this (`expect.poll`) rather than sleeping a fixed interval —
 * a fixed wait is what makes these tests flaky under load.
 */
export async function readStudioStore(page: Page): Promise<{ schemaVersion: number; layersJson: string } | null> {
  return page.evaluate((chapterId) => new Promise<{ schemaVersion: number; layersJson: string } | null>((resolve) => {
    const open = indexedDB.open('keyval-store');
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const req = open.result.transaction('keyval', 'readonly').objectStore('keyval').get(`studio_${chapterId}`);
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const d = req.result;
        resolve(d ? { schemaVersion: d.schemaVersion, layersJson: JSON.stringify(d.layersByPage) } : null);
      };
    };
  }), CHAPTER_ID);
}

/** Drags a horizontal brush stroke across the middle of the stage. */
export async function paintStroke(page: Page): Promise<void> {
  const box = (await page.locator('canvas').first().boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2 - 40, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, y, { steps: 12 });
  await page.mouse.up();
}

/**
 * Clicks `label` and waits for `expected` to appear, retrying the whole pair.
 *
 * The library drills through view transitions (`animate-view-fade`), so a click can land while the
 * outgoing view is still on screen and simply not register. Retrying the click-then-assert pair is
 * far more robust than a longer timeout on the click alone.
 */
async function clickThrough(page: Page, label: string, expected: string): Promise<void> {
  await expect(async () => {
    await page.getByText(label, { exact: true }).first().click({ timeout: 5_000 });
    await expect(page.getByText(expected).first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
}

/** Navigates workspace -> manga -> volume -> chapter into the Studio. Assumes data is seeded. */
export async function navigateToStudio(page: Page): Promise<void> {
  await clickThrough(page, 'E2E', 'E2E Manga');
  await clickThrough(page, 'E2E Manga', 'Vol 1');
  await clickThrough(page, 'Vol 1', 'Ch 1');
  await clickThrough(page, 'Ch 1', 'Layers');

  // The chapter has pages, so App jumps straight to the studio view; the Layers panel is the
  // cheapest reliable signal that the Studio shell has actually mounted.
  await page.getByRole('button', { name: 'Add layer' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('canvas').first().waitFor({ state: 'visible' });
}

/** Seeds, reloads, and clicks through workspace -> manga -> volume -> chapter into the Studio. */
export async function openStudio(page: Page): Promise<void> {
  await seedChapter(page);
  await page.reload();
  await navigateToStudio(page);
}

/**
 * Waits for the Layers panel to be interactive.
 *
 * The Layers panel now lives in its own always-visible column (see Studio.tsx's
 * rightPersistentColumn) rather than the tab-switched dock, so creating a text/adjustment layer
 * (which still auto-opens that layer's settings tab) no longer navigates away from it — there's
 * nothing left to click back to. Kept as a named step so call sites read the same either way.
 */
export async function openLayersPanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add layer' }).waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: 'Layers' }).or(page.getByText('Layers', { exact: true })).first().click();
  await page.getByRole('button', { name: 'Add layer', exact: true }).waitFor({ state: 'visible' });
}

/**
 * Types into the text-layer editing overlay.
 *
 * Waits for the textarea to be *focused*, not merely visible: focus is set in an effect one tick
 * after mount, and until then keystrokes fall through to the global tool shortcuts — which is how
 * "hello" silently became "ello" (`h` is the Hand tool). `pressSequentially` focuses first, so this
 * also can't race.
 *
 * `:not(#swal2-textarea)` excludes SweetAlert2's own permanently-hidden template textarea, which
 * sweetalert2 injects into the DOM once its module is loaded (before any dialog is ever shown) — a
 * plain `locator('textarea').first()` can resolve to it instead of the real editing overlay
 * depending on DOM insertion order, and then waits forever for a textarea that never becomes
 * visible, since that one never does.
 */
export async function typeIntoTextLayer(page: Page, text: string): Promise<void> {
  const textarea = page.locator('textarea:not(#swal2-textarea)').first();
  await textarea.waitFor({ state: 'visible' });
  await expect(textarea).toBeFocused();
  await textarea.pressSequentially(text);
}
