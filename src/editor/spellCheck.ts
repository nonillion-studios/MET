/**
 * Step 0 audit (this session, before any code changes) — answered from real code:
 *
 * A1. Tool options are a top options bar (`src/components/studio/toolOptions/ToolOptionsBar.tsx`),
 *     not a sidebar panel or floating popups — a single horizontal strip of sliders/selects
 *     gated per-tool by named Set membership (SIZE_TOOLS, FLOW_TOOLS, OPACITY_TOOLS, etc.).
 * A2. Every tool's options are computed from those Sets in ToolOptionsBar.tsx — e.g. brush/
 *     pencil/eraser get Size+Hardness+Flow+Opacity+(while SYMMETRY_TOOLS) Spacing/Smoothing/
 *     Scatter/Angle/Round/Tip-shape/Symmetry; bucket/gradient get Opacity; marquee/lasso/wand
 *     get selection add-subtract-intersect controls; spot-heal/clone/heal/blur/sharpen/smudge/
 *     dodge/burn/sponge/shape tools/liquify get Size (+Flow where listed); slice gets Add Rect/
 *     Export Slices buttons. Full membership lives in the Set definitions at the top of that file.
 * A3. TypeR's *Multi-Bubble* capture path (`Studio.tsx`'s `handleAddBubbleRect`) only accepts
 *     rect selections today — `if (selection.kind !== 'rect') { toast; return }` — and
 *     `setMultiBubbleMode` force-switches the active tool to `'marquee-rect'`. It does NOT read
 *     the general selection mask. Type Region (`handleCreateTypeRegion`, same file) already does
 *     read the real selection shape (`selectionBounds` + a `TextLayerData.clipShape` for ellipse/
 *     polygon) — Section 3 generalizes Multi-Bubble to reuse that existing mechanism.
 * A4. `TextEditorPage.tsx`'s `confirmSendToTyper` builds a scratch `<div>`, sets its `innerHTML`
 *     to the spell/status-mark-stripped page HTML, then reads `.innerText` and joins pages with
 *     `\n` — so line breaks *within* a page collapse to whatever `innerText` does with block
 *     elements, and no block-level line list is preserved explicitly. Section 4 replaces this
 *     with an explicit block-tag walker.
 * A5. Native only: a "Spell Check" toolbar button flips `spellCheckActive`, applied imperatively
 *     via `pageRefs.current.forEach(p => p.spellcheck = spellCheckActive)` in `TextEditorPage.tsx`.
 *     `src/lib/spellCheck.ts` still contains a full, disconnected EN+AR dictionary+marking
 *     implementation (`COMMON_MISSPELLINGS`, `markMisspellings`, `markMisspellingsLive`) — dead
 *     code, never called, superseded by this file. `ContextMenu.tsx` still has a matching dead
 *     `.spell-miss` branch. Section 5 deletes all of it.
 * A6. Eraser shares the exact same stamp/brush engine as Brush/Pencil — `effectiveTip()` in
 *     `paint/paintEngine.ts` builds tip geometry uniformly for `'brush' | 'pencil' | 'eraser'`;
 *     `usePaintLayer.ts` composites the eraser's stroke via `destination-out` on that same tip.
 *     No separate implementation exists.
 * A7. Eraser already supports every brush shape, not just a circle: `brushShape` (round/square/
 *     image) is one shared state in `Studio.tsx`, and `eraser` is already a member of both
 *     `SYMMETRY_TOOLS` (gates the Tip-shape dropdown in `ToolOptionsBar.tsx`) and `STROKE_TOOLS`
 *     (gates the square/round cursor outline in `ToolCursorOverlay.tsx`). The only real nuance:
 *     shape is one variable shared across brush/pencil/eraser, not independent per tool — by
 *     user decision this stays as-is (Section 2 is verify-only).
 * A8. `paint/paintEngine.ts`'s `contentAwareFill()` samples 4 single pixels just outside the
 *     target rect, averages them, flat-fills the rect, then scatters random low-alpha dots as
 *     "noise" — no patch matching, no gradient-domain blending. `healSegment()`/
 *     `colorMatchBlend()` copy a fixed-offset source region and correct its average color to
 *     match the destination, blended via radial falloff. Both run synchronously on the main
 *     thread; no `OffscreenCanvas`, Web Worker, Poisson/FFT/Perlin dependency exists anywhere
 *     in this repo.
 * A9. No minimap exists. `menuDefinitions.ts` has a permanently `disabled` "Minimap" stub menu
 *     item; CLAUDE.md's "Known gaps" already says so.
 * A10. No status bar exists (same kind of `disabled` stub in `menuDefinitions.ts`). The data a
 *     status bar needs already exists though: `StudioCanvas.tsx`'s `scale`/`pos` state and its
 *     `getZoom()`/`getViewTransform()` imperative-handle methods are tracked but never read by
 *     any UI today.
 * A11. No music/audio/YouTube player exists anywhere in the repo (confirmed by full-tree grep);
 *     `package.json` has no audio/media/YouTube library. `TyperFloatingWindow.tsx` is the only
 *     precedent for a draggable floating panel (CSS-fixed + manual pointermove/up, not a portal);
 *     `Modal.tsx`/`ChatBubbleMenu.tsx` are the only real `createPortal` usages in the app.
 * A12. Brush shapes are a real type union, not a free-form enum or hardcoded value:
 *     `BrushShape = 'round' | 'square'` in `paint/brushTip.ts`, plus a third `'image'` variant
 *     for imported custom tips (baked to an alpha mask once at import via `imageToBrushMask`).
 *     "Soft round"/"hard round" are the `hardness` parameter applied to the `'round'` shape, not
 *     separate shape values — the spec's "ink/manga/texture" shape names don't correspond to
 *     anything in this codebase (those read as brush *presets* in `brushStore.ts`'s built-ins,
 *     not brush *shapes*).
 *
 * `dictionary-ar` does not exist on the npm registry (wooorm's `dictionaries` project, which
 * `dictionary-en` comes from, never published Arabic). Arabic Hunspell data is vendored instead:
 * LibreOffice's `ar.aff`/`ar.dic` (via the Ayaspell project, GPL/LGPL/MPL tri-licensed) live in
 * `public/dictionaries/ar/` and are `fetch()`ed lazily below rather than `import()`ed as a
 * package — the ~7MB `.dic` must never enter a JS bundle.
 *
 * `dictionary-en@4` is *also* unusable as a runtime import here: its `index.js` reads
 * `index.aff`/`index.dic` off disk via `node:fs/promises` + `import.meta.url` at module-evaluation
 * time — real Node.js APIs with no browser equivalent, so bundling it for this app would fail (or
 * silently ship a broken stub). Its actual data files are plain UTF-8 Hunspell text underneath, so
 * they're vendored the same way as Arabic — copied once into `public/dictionaries/en/` (MIT/BSD
 * dual-licensed per the package's own `license` file, copied alongside as `LICENSE.txt`) — and the
 * npm package itself was uninstalled since nothing here imports its JS. `nspell` itself has no such
 * problem (pure logic, no Node built-ins) and is imported normally.
 */

import type NSpell from 'nspell';

interface SpellCheckResult {
  word: string;
  start: number;
  end: number;
  language: 'en' | 'ar';
  suggestions: string[];
}

let englishChecker: NSpell | null = null;
let arabicChecker: NSpell | null = null;
let loadingEnglish = false;
let loadingArabic = false;

const ARABIC_COLLOQUIAL_CORRECTIONS: Record<string, string> = {
  'لاكن': 'لكن', 'هاذا': 'هذا', 'هاذه': 'هذه', 'انا': 'أنا',
  'اكل': 'أكل', 'امر': 'أمر', 'اعطى': 'أعطى', 'ارض': 'أرض',
  'او': 'أو', 'اب': 'أب', 'اخ': 'أخ', 'ام': 'أم', 'ان': 'أن',
  'فية': 'فيه', 'عنة': 'عنه', 'معة': 'معه', 'لية': 'له',
  'علية': 'عليه', 'بية': 'به', 'أنة': 'أنه', 'اللة': 'الله',
  'هاؤلاء': 'هؤلاء', 'الي': 'الذي', 'اللي': 'الذي',
  'دة': 'ده', 'انشاء الله': 'إن شاء الله',
};

async function waitForChecker(getChecker: () => NSpell | null): Promise<NSpell> {
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (getChecker()) { clearInterval(check); resolve(); }
    }, 50);
  });
  return getChecker()!;
}

async function fetchDictionaryText(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load dictionary asset: ${path} (${res.status})`);
  return res.text();
}

async function loadEnglish(): Promise<NSpell> {
  if (englishChecker) return englishChecker;
  if (loadingEnglish) return waitForChecker(() => englishChecker);
  loadingEnglish = true;
  const [{ default: nspell }, aff, dic] = await Promise.all([
    import('nspell'),
    fetchDictionaryText('/dictionaries/en/en.aff'),
    fetchDictionaryText('/dictionaries/en/en.dic'),
  ]);
  englishChecker = nspell(aff, dic);
  loadingEnglish = false;
  return englishChecker;
}

async function loadArabic(): Promise<NSpell> {
  if (arabicChecker) return arabicChecker;
  if (loadingArabic) return waitForChecker(() => arabicChecker);
  loadingArabic = true;
  const [{ default: nspell }, aff, dic] = await Promise.all([
    import('nspell'),
    fetchDictionaryText('/dictionaries/ar/ar.aff'),
    fetchDictionaryText('/dictionaries/ar/ar.dic'),
  ]);
  arabicChecker = nspell(aff, dic);
  loadingArabic = false;
  return arabicChecker;
}

const ARABIC_RANGE = /[\u0600-\u06FF]/;
const ENGLISH_RANGE = /[a-zA-Z]/;

function detectLanguage(word: string): 'ar' | 'en' | 'other' {
  if (ARABIC_RANGE.test(word)) return 'ar';
  if (ENGLISH_RANGE.test(word)) return 'en';
  return 'other';
}

interface WordToken {
  word: string;
  start: number;
  end: number;
}

function tokenizeWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const pattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+|[a-zA-Z']+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    tokens.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

const ignoredWords = new Set<string>();

export function ignoreWord(word: string): void {
  ignoredWords.add(word.toLowerCase());
}

export function clearIgnoreList(): void {
  ignoredWords.clear();
}

export async function spellCheckText(text: string): Promise<SpellCheckResult[]> {
  if (!text.trim()) return [];
  const tokens = tokenizeWords(text);
  if (tokens.length === 0) return [];

  const needsEnglish = tokens.some((t) => detectLanguage(t.word) === 'en');
  const needsArabic = tokens.some((t) => detectLanguage(t.word) === 'ar');

  const [enChecker, arChecker] = await Promise.all([
    needsEnglish ? loadEnglish() : Promise.resolve(null),
    needsArabic ? loadArabic() : Promise.resolve(null),
  ]);

  const results: SpellCheckResult[] = [];

  for (const token of tokens) {
    const lang = detectLanguage(token.word);
    if (lang === 'other') continue;
    if (ignoredWords.has(token.word.toLowerCase())) continue;

    if (lang === 'en' && enChecker) {
      if (!enChecker.correct(token.word)) {
        results.push({
          word: token.word, start: token.start, end: token.end,
          language: 'en', suggestions: enChecker.suggest(token.word).slice(0, 5),
        });
      }
    }

    if (lang === 'ar' && arChecker) {
      const colloquialFix = ARABIC_COLLOQUIAL_CORRECTIONS[token.word];
      if (colloquialFix) {
        results.push({
          word: token.word, start: token.start, end: token.end,
          language: 'ar', suggestions: [colloquialFix],
        });
      } else if (!arChecker.correct(token.word)) {
        results.push({
          word: token.word, start: token.start, end: token.end,
          language: 'ar', suggestions: arChecker.suggest(token.word).slice(0, 5),
        });
      }
    }
  }

  return results;
}

export async function addWordToDictionary(word: string, language: 'en' | 'ar'): Promise<void> {
  if (language === 'en' && englishChecker) englishChecker.add(word);
  else if (language === 'ar' && arabicChecker) arabicChecker.add(word);
  ignoredWords.add(word.toLowerCase());
}

export type { SpellCheckResult };
