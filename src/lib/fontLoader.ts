import JSZip from 'jszip';

export interface LoadedFont {
  family: string;
  dataUrl: string;
}

/** A generic file-to-data-URL reader — lives here since font loading was its first user, but
 *  has no font-specific logic in it (the Text Editor's image insert reuses it verbatim). */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** The inverse of `dataUrlToArrayBuffer` — needed by the Google Fonts path, which fetches raw
 *  bytes over the network rather than reading a `File`. The MIME is never read back anywhere
 *  `.dataUrl` is used, so a generic default is safe regardless of the font's real format. */
export function arrayBufferToDataUrl(buffer: ArrayBuffer, mime = 'font/ttf'): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Parses a font's embedded family name (falls back to `fallbackFamily`) and registers it with
 *  the browser via the FontFace API so it's immediately usable. opentype.js is dynamically
 *  imported — it's only needed the moment someone actually installs a font. Shared by the
 *  single-file upload path, the ZIP-batch path, and — once padded through `arrayBufferToDataUrl`
 *  — nothing downstream needs to know which path a given font came from. */
export async function registerFontBytes(buffer: ArrayBuffer, fallbackFamily: string): Promise<LoadedFont> {
  let family = fallbackFamily;
  try {
    const opentype = await import('opentype.js');
    const parsed = opentype.parse(buffer.slice(0));
    const names = parsed.names.fontFamily;
    family = names.en || Object.values(names)[0] || family;
  } catch (err) {
    console.error('Could not read font metadata, using fallback name instead', err);
  }

  const fontFace = new FontFace(family, buffer.slice(0));
  await fontFace.load();
  document.fonts.add(fontFace);

  return { family, dataUrl: arrayBufferToDataUrl(buffer) };
}

export async function loadCustomFont(file: File): Promise<LoadedFont> {
  const dataUrl = await readFileAsDataUrl(file);
  const buffer = dataUrlToArrayBuffer(dataUrl);
  return registerFontBytes(buffer, file.name.replace(/\.[^.]+$/, ''));
}

const FONT_FILE_RE = /\.(ttf|otf|woff|woff2)$/i;

export interface FontExtractionResult {
  loaded: LoadedFont[];
  skipped: { filename: string; reason: string }[];
}

/** Batch-installs every TTF/OTF/WOFF/WOFF2 entry found inside an uploaded `.zip` — mirrors
 *  `lib/zip.ts`'s `extractImagesFromZip` shape (same skip/error bookkeeping), so a font pack
 *  archive can be dropped in the same way an image pack can. */
export async function extractFontsFromZip(file: File): Promise<FontExtractionResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    throw new Error(`"${file.name}" isn't a valid ZIP file${err instanceof Error ? `: ${err.message}` : ''}`);
  }

  const loaded: LoadedFont[] = [];
  const skipped: { filename: string; reason: string }[] = [];

  for (const [entryPath, entry] of Object.entries(zip.files)) {
    if (entry.dir || entryPath.startsWith('__MACOSX/')) continue;
    if (!FONT_FILE_RE.test(entryPath)) continue;

    const basename = entryPath.split('/').pop() || entryPath;
    try {
      const buffer = await entry.async('arraybuffer');
      loaded.push(await registerFontBytes(buffer, basename.replace(/\.[^.]+$/, '')));
    } catch (err) {
      skipped.push({ filename: basename, reason: err instanceof Error ? err.message : 'failed to load font' });
    }
  }

  return { loaded, skipped };
}

/** Re-registers a font already persisted from a previous session (skips re-parsing metadata
 *  since the family name is already known and stored) — also used by the Google Fonts download
 *  path, which already knows its curated family name and shouldn't risk opentype.js extracting a
 *  slightly different embedded name (e.g. a "Regular" suffix). */
export async function registerStoredFont(family: string, dataUrl: string): Promise<void> {
  const buffer = dataUrlToArrayBuffer(dataUrl);
  const fontFace = new FontFace(family, buffer);
  await fontFace.load();
  document.fonts.add(fontFace);
}
