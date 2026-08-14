import { createTextLayer, type StudioLayer, type TextLayerData } from '../studioTypes';
import { layoutText, isArabicMajority, type TextLayout } from '../textLayout';
import { justifyArabicLine } from './arabicKashida';
import type { TranslatedBubble } from '../../../lib/aiTranslateBubbles';
import type { ResolvedRunStyle } from '../textRuns';

export interface AutoTypesetStyle {
  dialogueFontFamily: string;
  sfxFontFamily: string;
  color: string;
  strokeColor: string;
  strokeWidth: number;
}

export type DetectBubbleBoundsFn = (x: number, y: number) => { centerX: number; centerY: number; width: number; height: number } | null;

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE_DIALOGUE = 32;
const MAX_FONT_SIZE_SFX = 64;
const PADDING_RATIO = 0.16;

function linesFromLayout(layout: TextLayout): string[] {
  const byLine = new Map<number, string>();
  for (const run of layout.runs) byLine.set(run.lineIndex, (byLine.get(run.lineIndex) ?? '') + run.text);
  return [...byLine.keys()].sort((a, b) => a - b).map(k => byLine.get(k) ?? '');
}

type BubbleBounds = { centerX: number; centerY: number; width: number; height: number };

/** A detected region that's too thin, too tiny, or an extreme sliver almost certainly means the
 *  seed landed on a stray ink/text pixel rather than the bubble fill (bubbleDetect.ts's flood fill
 *  is color-based, not shape-aware, so a single dark letter can flood-fill its own small connected
 *  blob) rather than a real bubble. */
function isPlausibleBubble(b: BubbleBounds): boolean {
  if (b.width < 12 || b.height < 12) return false;
  const aspect = b.width / Math.max(1, b.height);
  return aspect <= 6 && aspect >= 1 / 6;
}

const RETRY_RING_RADIUS_RATIOS = [0.03, 0.06, 0.1];
const RETRY_RING_POINTS = 8;

/**
 * Gemini's `seedX`/`seedY` is only ever a rough guess — landing it exactly on a bubble's white fill
 * isn't guaranteed, and a miss by a few percent can put it on the bubble's outline, on a letter's
 * own ink, or just outside the bubble entirely. Rather than trust one point, this tries the seed
 * itself first, then rings of points at increasing radius around it, keeping the largest plausible
 * result found — a cheap way to make the single-seed flood fill (bubbleDetect.ts) noticeably more
 * reliable against an imprecise seed without needing real bubble segmentation.
 */
function detectBubbleRobust(seedX: number, seedY: number, pageWidth: number, pageHeight: number, detectBubbleBounds: DetectBubbleBoundsFn): BubbleBounds | null {
  const direct = detectBubbleBounds(seedX, seedY);
  if (direct && isPlausibleBubble(direct)) return direct;

  const minDim = Math.min(pageWidth, pageHeight);
  let best: BubbleBounds | null = null;
  for (const radiusRatio of RETRY_RING_RADIUS_RATIOS) {
    const radius = radiusRatio * minDim;
    for (let i = 0; i < RETRY_RING_POINTS; i++) {
      const angle = (i / RETRY_RING_POINTS) * Math.PI * 2;
      const x = seedX + Math.cos(angle) * radius;
      const y = seedY + Math.sin(angle) * radius;
      if (x < 0 || x > pageWidth || y < 0 || y > pageHeight) continue;
      const candidate = detectBubbleBounds(x, y);
      if (candidate && isPlausibleBubble(candidate) && (!best || candidate.width * candidate.height > best.width * best.height)) {
        best = candidate;
      }
    }
    if (best) return best; // nearest successful ring wins — no need to search further out
  }
  return direct; // every retry failed too — hand back the direct (possibly null) result as-is
}

/**
 * Builds one fitted text layer for `bubble`. Two things this fixes over taking Gemini's numbers at
 * face value:
 *
 * 1. **Position/size** — Gemini is only asked for a rough point inside the bubble (`seedX`/`seedY`);
 *    this flood-fills from it via `detectBubbleBounds` (StudioCanvas's existing bubble detector, the
 *    same one "Center in Bubble" already uses — color-based, so it works on colored manhwa bubbles
 *    too, not just white ones) to find the bubble's real extent, retrying at a few points around the
 *    seed (`detectBubbleRobust` below) if the exact seed misses. Two bubbles joined by a thin neck
 *    come back as one connected region already — the flood fill doesn't know about bubble outlines,
 *    only color connectivity — so a merged pair sizes correctly for free rather than needing
 *    separate merge-detection logic.
 * 2. **Fit** — shrinks font size until the wrapped text fits the detected box, then (Arabic text
 *    only) applies kashida elongation (see arabicKashida.ts) to full-justify every line but the
 *    last, instead of leaving ragged line ends.
 *
 * Falls back to a fixed-size box centered on the seed point when flood fill finds nothing there
 * (e.g. the seed landed just outside the bubble, or on non-light background).
 */
export function autoTypesetBubble(bubble: TranslatedBubble, pageWidth: number, pageHeight: number, detectBubbleBounds: DetectBubbleBoundsFn, style: AutoTypesetStyle): StudioLayer {
  const seedX = bubble.seedX * pageWidth;
  const seedY = bubble.seedY * pageHeight;
  const detected = detectBubbleRobust(seedX, seedY, pageWidth, pageHeight, detectBubbleBounds);

  const fallbackSize = Math.max(80, Math.min(pageWidth, pageHeight) * 0.18);
  const centerX = detected?.centerX ?? seedX;
  const centerY = detected?.centerY ?? seedY;
  const boxWidth = Math.max(50, (detected?.width ?? fallbackSize) * (1 - PADDING_RATIO));
  const boxHeight = Math.max(30, (detected?.height ?? fallbackSize) * (1 - PADDING_RATIO));

  const arabic = isArabicMajority(bubble.text);
  const fontFamily = bubble.isSfx ? style.sfxFontFamily : style.dialogueFontFamily;
  const maxFontSize = bubble.isSfx ? MAX_FONT_SIZE_SFX : MAX_FONT_SIZE_DIALOGUE;

  const layer = createTextLayer(centerX - boxWidth / 2, centerY - boxHeight / 2, boxWidth, boxHeight);
  layer.name = `Text: ${bubble.text.slice(0, 20)}`;
  layer.text = {
    ...layer.text!,
    content: bubble.text,
    fontFamily,
    color: style.color,
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
    rotation: bubble.rotation,
    align: arabic ? 'right' : 'center',
    direction: arabic ? 'rtl' : 'ltr',
  };

  let fontSize = maxFontSize;
  let layout: TextLayout = layoutText(layer.text as TextLayerData);
  while (fontSize > MIN_FONT_SIZE) {
    layer.text!.fontSize = fontSize;
    layout = layoutText(layer.text as TextLayerData);
    if (!layout.overflowing && layout.width <= boxWidth) break;
    fontSize -= 2;
  }
  layer.text!.fontSize = fontSize;

  if (arabic) {
    const wrappedLines = linesFromLayout(layout);
    if (wrappedLines.length > 1) {
      const runStyle: ResolvedRunStyle = { fontFamily, fontSize, fontWeight: 400, color: style.color, italic: false, letterSpacing: 0, kerning: 0, baselineShift: 0 };
      const justified = wrappedLines.map((ln, i) => (i < wrappedLines.length - 1 ? justifyArabicLine(ln, boxWidth, runStyle) : ln));
      const candidate: TextLayerData = { ...(layer.text as TextLayerData), content: justified.join('\n') };
      const check = layoutText(candidate);
      // Kashida only ever adds width, never removes it — back off if it pushed the line past the
      // box rather than risk overflowing what was otherwise a good fit.
      if (!check.overflowing && check.width <= boxWidth * 1.05) layer.text = candidate;
    }
  }

  return layer;
}

export function autoTypesetPage(bubbles: TranslatedBubble[], pageWidth: number, pageHeight: number, detectBubbleBounds: DetectBubbleBoundsFn, style: AutoTypesetStyle): StudioLayer[] {
  return bubbles.map(b => autoTypesetBubble(b, pageWidth, pageHeight, detectBubbleBounds, style));
}
