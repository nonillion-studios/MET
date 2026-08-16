export type GoogleFontScript = 'latin' | 'arabic';

export interface CuratedGoogleFont {
  family: string;
  category: 'display' | 'handwriting' | 'multilingual';
  /** Which Unicode subset to prefer when Google's CSS2 response splits a family across several
   *  `@font-face` blocks — see `pickBlock`. Absent means Latin. */
  preferredScript?: GoogleFontScript;
}

/**
 * A hand-picked, deliberately small list of real, free (SIL Open Font License) Google Fonts
 * suited to comic/manga lettering — display and handwriting styles for dialogue/SFX, plus a few
 * Arabic-script entries (this app already ships Arabic dictionaries, see public/dictionaries/ar).
 * Not a live catalog search: the full Google Fonts catalog is 1,800+ families, which would be
 * impractical to browse or cache offline. Downloading any entry here goes through the same
 * StoredFont/fontLoader.ts pipeline as a manual upload (see FontsPanel.tsx), so once downloaded a
 * font needs no further network access — keeping this app's offline-after-first-use guarantee.
 */
export const CURATED_GOOGLE_FONTS: CuratedGoogleFont[] = [
  { family: 'Bangers', category: 'display' },
  { family: 'Luckiest Guy', category: 'display' },
  { family: 'Permanent Marker', category: 'handwriting' },
  { family: 'Bungee', category: 'display' },
  { family: 'Anton', category: 'display' },
  { family: 'Rubik Mono One', category: 'display' },
  { family: 'Righteous', category: 'display' },
  { family: 'Special Elite', category: 'handwriting' },
  { family: 'Caveat', category: 'handwriting' },
  { family: 'Shadows Into Light', category: 'handwriting' },
  { family: 'Kalam', category: 'handwriting' },
  { family: 'Patrick Hand', category: 'handwriting' },
  { family: 'Comic Neue', category: 'display' },
  { family: 'Baloo 2', category: 'display' },
  { family: 'Fredoka', category: 'display' },
  { family: 'Bagel Fat One', category: 'display' },
  { family: 'Chewy', category: 'display' },
  { family: 'Titan One', category: 'display' },
  { family: 'Gochi Hand', category: 'handwriting' },
  { family: 'Amiri', category: 'multilingual', preferredScript: 'arabic' },
  { family: 'Noto Naskh Arabic', category: 'multilingual', preferredScript: 'arabic' },
  { family: 'Cairo', category: 'multilingual', preferredScript: 'arabic' },
  { family: 'Tajawal', category: 'multilingual', preferredScript: 'arabic' },
  { family: 'Reem Kufi', category: 'multilingual', preferredScript: 'arabic' },
];

interface FontFaceBlock {
  url: string;
  unicodeRange?: string;
}

/** Pure string parsing — no network, no DOM — so it's directly unit-testable against
 *  hand-written CSS2 sample responses. */
export function parseFontFaceBlocks(css: string): FontFaceBlock[] {
  const blocks: FontFaceBlock[] = [];
  const blockRe = /@font-face\s*{([^}]*)}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(css))) {
    const body = m[1];
    const urlMatch = /url\((https:\/\/[^)]+\.woff2?)\)/.exec(body);
    if (!urlMatch) continue;
    const rangeMatch = /unicode-range:\s*([^;]+);/.exec(body);
    blocks.push({ url: urlMatch[1], unicodeRange: rangeMatch?.[1]?.trim() });
  }
  return blocks;
}

/**
 * Google's CSS2 API returns one `@font-face` block per Unicode subset for a multi-script family
 * (e.g. Cairo ships separate Arabic and Latin blocks) — this picks the one subset to download.
 * NOTE: this means a multilingual curated entry only gets ONE script's glyphs registered, not
 * both; genuinely mixed-script text in one bubble would show fallback glyphs for the other script.
 * Fixing that needs `StoredFont` to hold multiple `dataUrl`s per family — out of scope for now.
 */
export function pickBlock(blocks: FontFaceBlock[], preferredScript: GoogleFontScript = 'latin'): FontFaceBlock | undefined {
  if (blocks.length <= 1) return blocks[0];
  const marker = preferredScript === 'arabic' ? 'U+0600' : 'U+0000-00FF';
  return blocks.find(b => b.unicodeRange?.includes(marker)) ?? blocks[blocks.length - 1];
}

/**
 * Downloads one Google Font's file bytes at runtime, entirely client-side, via the public CSS2
 * API: fetches the CSS (no API key needed), regex-parses its `@font-face` block(s) for a
 * fonts.gstatic.com `.woff2` URL, then fetches that URL for the raw bytes. The caller feeds the
 * result through the same StoredFont/fontLoader.ts pipeline as an upload, so once downloaded the
 * font is cached in IndexedDB and needs no further network access.
 *
 * CORS behavior on fonts.googleapis.com/fonts.gstatic.com has not been verified against a live
 * browser — if either endpoint doesn't return permissive CORS headers, this will reject. Callers
 * must surface that as a normal error (see FontsPanel.tsx's download handlers), not assume success.
 */
export async function fetchGoogleFont(family: string, opts: { weight?: number; preferredScript?: GoogleFontScript } = {}): Promise<ArrayBuffer> {
  const weight = opts.weight ?? 400;
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${weight}&display=swap`;

  let cssText: string;
  try {
    const cssRes = await fetch(cssUrl);
    if (!cssRes.ok) throw new Error(`Google Fonts CSS request failed (${cssRes.status})`);
    cssText = await cssRes.text();
  } catch (err) {
    throw new Error(`Couldn't reach Google Fonts for "${family}"${err instanceof Error ? ` (${err.message})` : ''}`);
  }

  const chosen = pickBlock(parseFontFaceBlocks(cssText), opts.preferredScript);
  if (!chosen) throw new Error(`Google Fonts didn't return a usable font file for "${family}"`);

  const fileRes = await fetch(chosen.url);
  if (!fileRes.ok) throw new Error(`Failed to download the "${family}" font file (${fileRes.status})`);
  return fileRes.arrayBuffer();
}
