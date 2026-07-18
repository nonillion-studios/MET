import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { seedChapter } from './studioFixture';

/**
 * Covers the Library "edit card info" + self-describing ZIP round-trip: renaming a series via its
 * pencil button, downloading it as a ZIP, confirming the ZIP carries `info.json` (not just raw page
 * images), then importing that same ZIP back and confirming the name survives the round-trip.
 */
test('renaming a series and round-tripping it through a downloaded ZIP preserves the name', async ({ page }) => {
  await seedChapter(page);
  await page.reload();

  await page.getByText('E2E', { exact: true }).first().click();
  await expect(page.getByText('E2E Manga').first()).toBeVisible();

  // Rename "E2E Manga" -> "Renamed Manga" via its pencil (edit-info) button.
  const card = page.locator('button', { has: page.getByText('E2E Manga', { exact: true }) }).first();
  await card.hover();
  await card.getByRole('button', { name: 'Edit series info' }).click();

  const nameInput = page.getByPlaceholder('Name');
  await expect(nameInput).toBeVisible();
  await nameInput.fill('Renamed Manga');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Renamed Manga', { exact: true }).first()).toBeVisible();

  // Download the renamed series as a ZIP and inspect its contents directly.
  const downloadPromise = page.waitForEvent('download');
  const renamedCard = page.locator('button', { has: page.getByText('Renamed Manga', { exact: true }) }).first();
  await renamedCard.hover();
  await renamedCard.getByRole('button', { name: 'Download series as ZIP' }).click();
  const download = await downloadPromise;

  // `download.path()` is an internal temp path with a random name — save under the suggested
  // filename ("Renamed_Manga.zip") so re-importing it below produces a `File` whose `.name`
  // matches what a real user's browser would hand back.
  const os = await import('node:os');
  const path = await import('node:path');
  const zipPath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(zipPath);

  const fs = await import('node:fs/promises');
  const zipBuffer = await fs.readFile(zipPath);
  const zip = await JSZip.loadAsync(zipBuffer);
  const infoRaw = await zip.file('Renamed_Manga/info.json')?.async('text');
  expect(infoRaw).toBeTruthy();
  expect(JSON.parse(infoRaw!)).toMatchObject({ name: 'Renamed Manga', type: 'manga' });

  // Back to the workspace root, then import that same ZIP and confirm the series name (from
  // info.json, not the sanitized folder/file name) round-trips into the newly imported workspace.
  await page.goto('/');
  await page.reload();
  const importInput = page.locator('input[type="file"][accept=".zip"]');
  await importInput.setInputFiles(zipPath!);
  await expect(page.getByText(/^Imported "/)).toBeVisible({ timeout: 15_000 });

  const importedWorkspaceCard = page.locator('button', { has: page.getByText('Renamed_Manga', { exact: true }) }).first();
  await importedWorkspaceCard.click();
  await expect(page.getByText('Renamed Manga', { exact: true }).first()).toBeVisible();
});
