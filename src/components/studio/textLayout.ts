import type { TextLayerData, TextRun } from './studioTypes';
import { normalizeRuns, resolveRunStyle, resolveLineStyle, runFontString, type ResolvedRunStyle } from './textRuns';

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
}

/** A run sliced down to a single line, before horizontal alignment is applied. */
interface LinePiece {
  text: string;
  style: ResolvedRunStyle;
  /** Manual kern inserted before this piece (only at a real run boundary, never mid-wrap). */
  kerning: number;
  width: number;
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
 */
export function layoutText(text: TextLayerData): TextLayout {
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

  const lineWidths = resolvedLines.map(line => line.reduce((sum, p) => sum + p.kerning + p.width, 0));
  // Point text is as wide as its content; box text keeps its authored width so alignment has a box.
  const contentWidth = Math.max(0, ...lineWidths);
  const boxWidth = text.autoWidth ? contentWidth : text.width;
  const lineStep = text.fontSize * text.lineHeight;

  const runs: PositionedRun[] = [];
  const lineMetrics: LineMetrics[] = [];
  resolvedLines.forEach((line, lineIndex) => {
    // Line height is driven by the layer's fontSize so a big run doesn't reflow the whole block —
    // matching Konva's own lineHeight behaviour, which the layer style has always defined.
    const lineTop = lineIndex * lineStep;
    lineMetrics.push({ y: lineTop, height: lineStep });
    const lineWidth = lineWidths[lineIndex];
    const align = text.lineOverrides?.[lineIndex]?.align ?? text.align;

    let x = 0;
    if (align === 'center') x = (boxWidth - lineWidth) / 2;
    else if (align === 'right') x = boxWidth - lineWidth;
    // 'justify' anchors left; canvas 2D has no justify and inter-word stretch isn't implemented,
    // so this matches how it's rendered rather than silently dropping the setting.

    for (const piece of line) {
      x += piece.kerning;
      runs.push({
        text: piece.text,
        x,
        // Runs sit on a shared baseline, so a larger run's em box starts higher. baselineShift
        // then lifts (+) or drops (-) just that run.
        y: lineTop + (text.fontSize - piece.style.fontSize) - piece.style.baselineShift,
        style: piece.style,
        lineIndex,
      });
      x += piece.width;
    }
  });

  const naturalHeight = Math.max(1, lines.length) * lineStep;
  return {
    runs,
    width: boxWidth,
    height: naturalHeight,
    // Approximates the baseline at 80% of the em box — canvas gives no baseline metric without
    // measuring, and this only positions a visual guide.
    firstBaselineY: text.fontSize * 0.8,
    lines: lineMetrics,
    overflowing: !text.autoWidth && text.fixedHeight != null && naturalHeight > text.fixedHeight,
  };
}
