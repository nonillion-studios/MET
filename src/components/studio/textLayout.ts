import type { TextLayerData, TextRun } from './studioTypes';
import { normalizeRuns, resolveRunStyle, resolveLineStyle, runFontString, type ResolvedRunStyle } from './textRuns';
import { resolveLineBidi, wrapForcedRtl } from './textBidi';

/**
 * Whether `text` reads as Arabic-script content — used to default a freshly-typed text layer to
 * RTL/right alignment (Photoshop/Illustrator both auto-detect script direction the same way rather
 * than asking up front). Counts letters only, so punctuation/digits/spaces don't dilute the ratio.
 */
// Arabic, Arabic Supplement, Arabic Extended-A, and Arabic Presentation Forms A/B blocks.
const ARABIC_SCRIPT_RANGE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/gu;

export function isArabicMajority(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (!letters) return false;
  const arabic = letters.match(ARABIC_SCRIPT_RANGE)?.length ?? 0;
  return arabic / letters.length > 0.5;
}

/** One run's worth of text on one line, already positioned in the layer's local coords. */
export interface PositionedRun {
  text: string;
  /** Only set when it differs from `text` — the bidi-forced-direction string (see textBidi.ts's
   *  wrapForcedRtl) actually measured/drawn for this run, so an RTL-context piece with no strong
   *  leading character (e.g. a bare number between two Arabic words) shapes/orders correctly.
   *  Rendering call sites must use `drawText ?? text`; `text` itself always stays the clean,
   *  unmodified original so consumers that reconstruct logical content (autoTypeset.ts's
   *  linesFromLayout) are unaffected. */
  drawText?: string;
  /** Left edge of this piece, relative to the layer's x. */
  x: number;
  /** Top of the em box, relative to the layer's y — i.e. a canvas `textBaseline='top'` origin. */
  y: number;
  style: ResolvedRunStyle;
  /** Index into the wrapped line list — what `TextLayerData.lineOverrides` and line selection key against. */
  lineIndex: number;
}

/** A wrapped line's own bounds, relative to the layer's y — for line-click hit targets and the
 *  overflow check, independent of any particular run inside it. */
export interface LineMetrics {
  y: number;
  height: number;
}

export interface TextLayout {
  runs: PositionedRun[];
  /** Widest line. For point text this *is* the layer's width — nothing else knows it. */
  width: number;
  height: number;
  /** Where the first line's baseline sits, relative to the layer's y (for the baseline guide). */
  firstBaselineY: number;
  lines: LineMetrics[];
  /** True once laid-out content exceeds `text.fixedHeight` (area text with a fixed frame only). */
  overflowing: boolean;
  /** The fontSize this layout actually used — equal to `text.fontSize` unless `autoFitFontSize`
   *  shrank it to fit `fixedHeight`. Callers that need the *effective* on-screen size (rather than
   *  the stored ceiling) read this instead of `text.fontSize` — see fitFontSizeToBox below. */
  resolvedFontSize: number;
}

/** A run sliced down to a single line, before horizontal alignment is applied. */
interface LinePiece {
  text: string;
  style: ResolvedRunStyle;
  /** Manual kern inserted before this piece (only at a real run boundary, never mid-wrap). */
  kerning: number;
  width: number;
  /** Set only for a bidi-forced-direction piece — see PositionedRun.drawText. */
  drawText?: string;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/**
 * Konva measures with `ctx.measureText` on its own offscreen canvas, so measuring the same way is
 * what keeps our layout and Konva's glyph painting agreeing. Reused across calls — creating a
 * canvas per measurement in a wrap loop is enough to be felt while typing.
 */
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  if (typeof document === 'undefined') return null;
  measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

export function measureRunText(text: string, style: ResolvedRunStyle): number {
  if (!text) return 0;
  const ctx = getMeasureCtx();
  if (!ctx) return text.length * style.fontSize * 0.5; // headless fallback; layout stays finite
  ctx.font = runFontString(style);
  // Deliberately Konva's own formula (see its Text#_getTextWidth): measure *without* native
  // letterSpacing, then add it per character. Konva draws spaced text letter-by-letter with that
  // same advance, so matching the formula is what keeps a run's laid-out width equal to the width
  // Konva actually renders — which is what lets us butt runs up against each other.
  applyLetterSpacing(ctx, 0);
  return ctx.measureText(text).width + style.letterSpacing * text.length;
}

/** Supported in Chromium/Safari; older engines ignore it rather than throw. */
export function applyLetterSpacing(ctx: CanvasRenderingContext2D, letterSpacing: number) {
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${letterSpacing || 0}px`;
}

/** Splits `content` into runs, then each run at newlines, yielding per-paragraph piece lists. */
function paragraphsOf(text: TextLayerData): LinePiece[][] {
  const runs = normalizeRuns(text.content, text.runs ?? []);
  const effective: TextRun[] = runs.length > 0 ? runs : [{ length: text.content.length }];

  const paragraphs: LinePiece[][] = [[]];
  let offset = 0;
  for (const run of effective) {
    const style = resolveRunStyle(text, run);
    const slice = text.content.slice(offset, offset + run.length);
    offset += run.length;

    // A run can straddle newlines; each \n starts a new paragraph but keeps the run's style.
    const chunks = slice.split('\n');
    chunks.forEach((chunk, i) => {
      if (i > 0) paragraphs.push([]);
      if (!chunk) return;
      const kerning = i === 0 ? style.kerning : 0; // kern applies at the run boundary, not after a break
      paragraphs[paragraphs.length - 1].push({ text: chunk, style, kerning, width: measureRunText(chunk, style) });
    });
  }
  return paragraphs;
}

/**
 * Greedy word-wrap across run boundaries: a paragraph's pieces are walked as one stream of words,
 * so a line can break *inside* a run and a word can carry styling from two runs. Wrapping each run
 * independently would break lines at every style change instead.
 */
function wrapParagraph(pieces: LinePiece[], maxWidth: number): LinePiece[][] {
  if (pieces.length === 0) return [[]];

  const lines: LinePiece[][] = [[]];
  let lineWidth = 0;

  const pushPiece = (piece: LinePiece) => {
    const line = lines[lines.length - 1];
    const prev = line[line.length - 1];
    // Same style and no kern of its own -> extend, so we don't emit a node per word.
    if (prev && prev.style === piece.style && piece.kerning === 0) {
      prev.text += piece.text;
      prev.width = measureRunText(prev.text, prev.style);
    } else {
      line.push(piece);
    }
    lineWidth = lineOf(line);
  };

  const lineOf = (line: LinePiece[]) => line.reduce((sum, p) => sum + p.kerning + p.width, 0);

  for (const piece of pieces) {
    // Keep the separators: splitting on /(\s+)/ lets us re-attach spaces to the preceding word.
    const tokens = piece.text.split(/(\s+)/).filter(t => t !== '');
    let firstToken = true;

    for (const token of tokens) {
      const isSpace = /^\s+$/.test(token);
      const width = measureRunText(token, piece.style);
      const kerning = firstToken ? piece.kerning : 0;
      firstToken = false;

      const fits = lineWidth + kerning + width <= maxWidth;
      const lineEmpty = lines[lines.length - 1].length === 0;

      if (!fits && !lineEmpty && !isSpace) {
        lines.push([]);
        lineWidth = 0;
        pushPiece({ text: token, style: piece.style, kerning: 0, width });
        continue;
      }
      // A space that would overflow is dropped rather than starting a line with whitespace.
      if (!fits && isSpace) continue;
      pushPiece({ text: token, style: piece.style, kerning, width });
    }
  }
  return lines;
}

/**
 * Lays a text layer out into positioned runs.
 *
 * Shared by the canvas renderer and the raster exporter — the single source of truth for wrapping,
 * the box, alignment and baselines, so the two can't disagree. (They previously each did their own
 * wrapping, which is exactly how point text ended up exporting wrapped when it doesn't wrap on
 * canvas.)
 *
 * Takes `text.fontSize` as-is — the public `layoutText` below is what resolves `autoFitFontSize`
 * before calling this, so `fitFontSizeToBox`'s own probing calls can reach this directly without
 * recursing back into the auto-fit search.
 */
function layoutAt(text: TextLayerData): TextLayout {
  const paragraphs = paragraphsOf(text);
  // Point text grows to fit and never wraps; box text wraps at its authored width.
  const lines = text.autoWidth
    ? paragraphs.map(p => (p.length ? p : []))
    : paragraphs.flatMap(p => wrapParagraph(p, text.width));

  // A line override can change fontSize/letterSpacing, which the pre-wrap piece widths above
  // (measured before any line index existed to look an override up by) don't reflect — an
  // overridden line is re-measured here so its own width/alignment stay correct, at the one-time
  // cost of remeasuring just that line's pieces.
  const resolvedLines = lines.map((line, lineIndex) => {
    const override = text.lineOverrides?.[lineIndex];
    if (!override) return line;
    return line.map(piece => {
      const style = resolveLineStyle(piece.style, override);
      return { ...piece, style, width: measureRunText(piece.text, style) };
    });
  });

  // Bidi resolution: for each line, compute each piece's visual x-rank and, for pieces that need
  // it, a forced-direction drawText + re-measured width (see textBidi.ts's resolveLineBidi /
  // wrapForcedRtl). A line with no RTL-script content takes resolveLineBidi's identity fast path
  // and this is a no-op.
  const bidiLines = resolvedLines.map(line => {
    const { visualRank, forceRtl } = resolveLineBidi(line);
    if (forceRtl.size === 0) return { pieces: line, visualRank };
    const pieces = line.map((piece, i) => {
      if (!forceRtl.has(i)) return piece;
      const drawText = wrapForcedRtl(piece.text);
      return { ...piece, drawText, width: measureRunText(drawText, piece.style) };
    });
    return { pieces, visualRank };
  });

  const lineWidths = bidiLines.map(({ pieces }) => pieces.reduce((sum, p) => sum + p.kerning + p.width, 0));
  // Point text is as wide as its content; box text keeps its authored width so alignment has a box.
  const contentWidth = Math.max(0, ...lineWidths);
  const boxWidth = text.autoWidth ? contentWidth : text.width;
  const lineStep = text.fontSize * text.lineHeight;
  const naturalHeight = Math.max(1, resolvedLines.length) * lineStep;
  // Only area text with a fixed frame has slack to distribute — content taller than the frame
  // still starts at the top and clips at the bottom, same as today, rather than being pushed
  // partly off-screen.
  const verticalOffset = !text.autoWidth && text.fixedHeight != null && text.verticalAlign
    ? Math.max(0, text.verticalAlign === 'middle'
        ? (text.fixedHeight - naturalHeight) / 2
        : text.verticalAlign === 'bottom' ? text.fixedHeight - naturalHeight : 0)
    : 0;

  const runs: PositionedRun[] = [];
  const lineMetrics: LineMetrics[] = [];
  bidiLines.forEach(({ pieces: line, visualRank }, lineIndex) => {
    // Line height is driven by the layer's fontSize so a big run doesn't reflow the whole block —
    // matching Konva's own lineHeight behaviour, which the layer style has always defined.
    const lineTop = lineIndex * lineStep + verticalOffset;
    lineMetrics.push({ y: lineTop, height: lineStep });
    const lineWidth = lineWidths[lineIndex];
    const align = text.lineOverrides?.[lineIndex]?.align ?? text.align;

    let boxOffset = 0;
    if (align === 'center') boxOffset = (boxWidth - lineWidth) / 2;
    else if (align === 'right') boxOffset = boxWidth - lineWidth;
    // 'justify' anchors left; canvas 2D has no justify and inter-word stretch isn't implemented,
    // so this matches how it's rendered rather than silently dropping the setting.

    // Walk pieces in VISUAL order to accumulate each one's x-offset (bidi-correct for RTL/mixed
    // lines, identical to typed order for plain LTR lines), but store each result back into an
    // array indexed by the piece's ORIGINAL position — so the loop below that builds `runs[]` can
    // keep iterating `line` in its original logical/typed order. That's what keeps `runs[]`'s array
    // order and each run's `text` exactly as typed, which autoTypeset.ts's linesFromLayout (and any
    // other consumer that reconstructs logical content) depends on; only the *position* changes.
    const visualOrder = line.map((_, i) => i).sort((a, b) => visualRank[a] - visualRank[b]);
    const xByPiece = new Array<number>(line.length);
    let visualX = 0;
    for (const i of visualOrder) {
      visualX += line[i].kerning;
      xByPiece[i] = visualX;
      visualX += line[i].width;
    }

    line.forEach((piece, i) => {
      runs.push({
        text: piece.text,
        drawText: piece.drawText,
        x: boxOffset + xByPiece[i],
        // Runs sit on a shared baseline, so a larger run's em box starts higher. baselineShift
        // then lifts (+) or drops (-) just that run.
        y: lineTop + (text.fontSize - piece.style.fontSize) - piece.style.baselineShift,
        style: piece.style,
        lineIndex,
      });
    });
  });

  return {
    runs,
    // Box text can still overflow its authored width (a single token longer than the frame isn't
    // broken or clipped by wrapParagraph) — report the true rendered extent so the selection box,
    // hit-rect, and W×H readout never claim a narrower box than what's actually on screen.
    width: Math.max(boxWidth, contentWidth),
    // The natural content height — unaffected by verticalAlign, which only repositions content
    // within a fixed frame, not its measured size (so overflow/W×H-readout stay meaningful).
    height: naturalHeight,
    // Approximates the baseline at 80% of the em box — canvas gives no baseline metric without
    // measuring, and this only positions a visual guide. Shifted by verticalOffset so it still
    // points at the first line's actual rendered position.
    firstBaselineY: text.fontSize * 0.8 + verticalOffset,
    lines: lineMetrics,
    overflowing: !text.autoWidth && text.fixedHeight != null
      && naturalHeight > text.fixedHeight * (text.autoFitFontSize ? AUTO_FIT_HEIGHT_BUFFER : 1),
    resolvedFontSize: text.fontSize,
  };
}

/** Font size never searched below this — matches TextPanel's own font-size input `min`, so the
 *  ceiling (the stored `fontSize`) and the floor stay in the same visible range as manual editing. */
const MIN_AUTO_FIT_FONT_SIZE = 6;

/** Auto-fit only: 8%/4% slack so a fixed frame drawn to a curved speech-bubble's rectangular
 *  bounding box doesn't force text to shrink tighter than the bubble's own curved edges need. Only
 *  ever applied when `autoFitFontSize` is on (see the `overflowing` computation above and
 *  `fitFontSizeToBox` below) — a plain fixed-height box with auto-fit off is unaffected. */
export const AUTO_FIT_HEIGHT_BUFFER = 1.08;
const AUTO_FIT_WIDTH_BUFFER = 1.04;

/**
 * Binary-searches the largest fontSize at or below the layer's own `fontSize` (a ceiling, never a
 * floor — auto-fit only ever shrinks type, matching how the Text panel's numeric Size input keeps
 * meaning as a "max size" once auto-fit is on) that lays out without overflowing `fixedHeight` or
 * the box's `width`. Only ever called by `layoutText` below, and only when `autoFitFontSize` is on
 * for an area (box) layer with a fixed frame — a point layer or one with no `fixedHeight` has no
 * frame to fit against.
 *
 * Known v1 limitation: a run with its own explicit `fontSize` override (`TextRun.fontSize`) keeps
 * that absolute value regardless of the search below, since `resolveRunStyle` only falls back to
 * the layer's `fontSize` when a run has no override of its own. Auto-fit is meant for uniform-style
 * bubble text, not layers leaning on heavy per-character size overrides.
 */
function fitFontSizeToBox(text: TextLayerData): number {
  const max = text.fontSize;
  if (max <= MIN_AUTO_FIT_FONT_SIZE) return max;

  const fits = (size: number) => {
    const probe = layoutAt({ ...text, fontSize: size });
    return !probe.overflowing && probe.width <= text.width * AUTO_FIT_WIDTH_BUFFER;
  };

  if (fits(max)) return max;
  if (!fits(MIN_AUTO_FIT_FONT_SIZE)) return MIN_AUTO_FIT_FONT_SIZE;

  let lo = MIN_AUTO_FIT_FONT_SIZE, hi = max;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return Math.floor(lo);
}

/**
 * Lays a text layer out — the public entry point `TextLayerNode.tsx`, `exportImage.ts`, and every
 * other caller in this codebase uses. Resolves `autoFitFontSize` (see `fitFontSizeToBox`) before
 * delegating to `layoutAt`, so every caller gets the shrunk-to-fit size for free without having to
 * know auto-fit exists; `TextLayout.resolvedFontSize` on the result exposes the effective size for
 * callers that need it directly (e.g. an editing textarea's own CSS font-size).
 */
export function layoutText(text: TextLayerData): TextLayout {
  const shouldAutoFit = !text.autoWidth && text.fixedHeight != null && !!text.autoFitFontSize;
  const resolvedFontSize = shouldAutoFit ? fitFontSizeToBox(text) : text.fontSize;
  return resolvedFontSize === text.fontSize ? layoutAt(text) : layoutAt({ ...text, fontSize: resolvedFontSize });
}
