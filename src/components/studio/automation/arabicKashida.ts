import { measureRunText } from '../textLayout';
import type { ResolvedRunStyle } from '../textRuns';

/**
 * Best-effort Arabic full-justify via kashida (ـ / U+0640 TATWEEL) elongation, the traditional
 * Arabic alternative to Western "stretch the spaces" justification. This is a heuristic, not real
 * text shaping — it doesn't know a font's actual glyph-joining metrics (that needs an OpenType
 * shaping engine like HarfBuzz, which nothing in this app embeds), so it approximates with the
 * standard rule-of-thumb: tatweel can be inserted after any Arabic letter *except* the six that
 * never connect to a following letter. Renders correctly in any font that includes the tatweel
 * glyph and supports basic Arabic joining (which browsers' native text shaping already gives us for
 * free via Konva/canvas `fillText`) — an unusual custom font without Arabic glyph coverage will just
 * show tofu for the inserted characters, same as it would for the Arabic text itself.
 */

const TATWEEL = 'ـ';

// Letters with no glyph variant that connects to a following letter — never a valid kashida site.
const NON_CONNECTING = new Set(['ا', 'أ', 'إ', 'آ', 'د', 'ذ', 'ر', 'ز', 'و', 'ة', 'ى']);

function isArabicLetter(ch: string): boolean {
  return /[ء-ي٠-٩]/.test(ch);
}

/** Candidate insertion indices within `word` (position = insert *after* this char index). */
function kashidaCandidates(word: string): number[] {
  const sites: number[] = [];
  for (let i = 0; i < word.length - 1; i++) {
    if (isArabicLetter(word[i]) && isArabicLetter(word[i + 1]) && !NON_CONNECTING.has(word[i])) sites.push(i);
  }
  return sites;
}

/** Stretches `line` toward `targetWidthPx` by inserting tatweel at valid join points, spread
 *  evenly across candidate sites rather than piled into one word. Returns the line unchanged if it
 *  already meets/exceeds the target or has no valid insertion sites. Caps insertions per site at 3
 *  so no single joint turns into a visibly absurd stretch. */
export function justifyArabicLine(line: string, targetWidthPx: number, style: ResolvedRunStyle): string {
  const currentWidth = measureRunText(line, style);
  if (currentWidth >= targetWidthPx) return line;
  const kashidaWidth = measureRunText(TATWEEL, style);
  if (kashidaWidth <= 0) return line;

  const words = line.split(' ');
  const allSites: { wordIndex: number; charIndex: number }[] = [];
  words.forEach((word, wordIndex) => {
    for (const charIndex of kashidaCandidates(word)) allSites.push({ wordIndex, charIndex });
  });
  if (allSites.length === 0) return line;

  const gapPx = targetWidthPx - currentWidth;
  const totalInsertions = Math.min(allSites.length * 3, Math.max(1, Math.round(gapPx / kashidaWidth)));

  const perSiteCount = new Map<number, number>();
  for (let i = 0; i < totalInsertions; i++) {
    const site = allSites[i % allSites.length];
    const key = site.wordIndex * 10000 + site.charIndex;
    perSiteCount.set(key, Math.min(3, (perSiteCount.get(key) ?? 0) + 1));
  }

  const rebuilt = words.map((word, wordIndex) => {
    let out = '';
    for (let i = 0; i < word.length; i++) {
      out += word[i];
      const count = perSiteCount.get(wordIndex * 10000 + i) ?? 0;
      if (count > 0) out += TATWEEL.repeat(count);
    }
    return out;
  });
  return rebuilt.join(' ');
}
