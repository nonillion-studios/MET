import bidiFactory from 'bidi-js';

const bidi = bidiFactory();

/** Hebrew, Arabic, Arabic Supplement, Arabic Extended-A, and the Hebrew/Arabic presentation-forms
 *  blocks — the cheap pre-check that lets a line with no RTL-script characters at all (the
 *  overwhelming common case) skip bidi-js entirely. Broader than textLayout.ts's own
 *  Arabic-only `ARABIC_SCRIPT_RANGE` (used only to auto-set align on first RTL content) since this
 *  one gates real bidi resolution and should also cover Hebrew. */
const RTL_SCRIPT_RANGE = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;

/** RTL embedding markers (RLE/RLM), matching the convention the example/ prototype's AutoFitText
 *  already validated in production. */
const RLE = '‫';
const RLM = '‏';

export interface BidiPiece {
  text: string;
}

export interface BidiResolution {
  /** For each piece index (0-based, matching the input array), its visual x-rank — 0 is the
   *  leftmost piece to draw. Use this to compute x offsets; never use it to reorder the pieces
   *  array itself or its text — callers must keep logical/typed order intact for anything that
   *  reconstructs content (e.g. autoTypeset.ts's linesFromLayout). */
  visualRank: number[];
  /** Piece indices whose own text should be measured/drawn wrapped in RLE…RLM, because they
   *  resolve to an RTL context but don't start with a strong RTL character (e.g. a bare number or
   *  punctuation token sitting between two Arabic words) — the browser's own per-call bidi
   *  resolution can't infer that context from an isolated piece's text alone. */
  forceRtl: Set<number>;
}

/** Wraps `pieceText` in the RTL embedding markers used for `forceRtl` pieces — measure and draw
 *  must both use this exact string so layout math and the rendered glyphs never disagree. */
export function wrapForcedRtl(pieceText: string): string {
  return RLE + pieceText + RLM;
}

/**
 * Resolves how a wrapped line's pieces (already in logical/typed order, as produced by
 * textLayout.ts's wrapParagraph) should be visually positioned relative to each other, per the
 * Unicode Bidirectional Algorithm (UAX9). Delegates bidi character classification and level
 * resolution — the genuinely hard, error-prone part — to bidi-js; the reordering itself (UAX9 rule
 * L2: reverse maximal runs from the highest level down to the lowest odd level) is implemented
 * here directly at *piece* granularity rather than per-character, since a piece (one style run,
 * already merged across same-style wrap tokens by wrapParagraph's pushPiece) is the atomic
 * drawable unit in this codebase's per-run Konva.Text rendering.
 *
 * Reordering only the pieces (not each piece's own internal characters) is a deliberate, sound
 * simplification: a single piece's own text is still handed to one fillText/Konva.Text call, and
 * the browser already bidi-shapes/orders that call's characters correctly on its own. Only the
 * *relative order of separate pieces* — which only diverges from typed order when a TextRun style
 * override or manual kerning splits otherwise-uniform RTL content onto the same line — needs
 * correcting here.
 */
export function resolveLineBidi(pieces: BidiPiece[]): BidiResolution {
  const identity = pieces.map((_, i) => i);
  if (pieces.length <= 1 || !pieces.some(p => RTL_SCRIPT_RANGE.test(p.text))) {
    return { visualRank: identity, forceRtl: new Set() };
  }

  // Concatenate with offset tracking so bidi-js resolves levels with full-line context rather
  // than each piece in isolation (context is exactly what's needed to correctly resolve a
  // digit/punctuation-only piece sitting between two Arabic words, for example).
  const offsets: number[] = [];
  let text = '';
  for (const p of pieces) {
    offsets.push(text.length);
    text += p.text;
  }

  const { levels } = bidi.getEmbeddingLevels(text);
  const pieceLevels = pieces.map((_, i) => levels[offsets[i]] ?? 0);

  const order = [...identity];
  const maxLevel = Math.max(0, ...pieceLevels);
  const oddLevels = pieceLevels.filter(l => l % 2 === 1);
  if (oddLevels.length > 0) {
    const minOddLevel = Math.min(...oddLevels);
    for (let level = maxLevel; level >= minOddLevel; level--) {
      let runStart = -1;
      for (let i = 0; i <= order.length; i++) {
        const atLevel = i < order.length && pieceLevels[order[i]] >= level;
        if (atLevel && runStart === -1) {
          runStart = i;
        } else if (!atLevel && runStart !== -1) {
          reverseInPlace(order, runStart, i - 1);
          runStart = -1;
        }
      }
    }
  }

  const visualRank = new Array<number>(pieces.length);
  order.forEach((pieceIndex, rank) => {
    visualRank[pieceIndex] = rank;
  });

  const forceRtl = new Set<number>();
  pieces.forEach((p, i) => {
    // The piece's own first STRONG character, not literally its first character — wrap-token
    // boundaries commonly land a separator space at the start of a piece (wrapParagraph re-attaches
    // it to the following word), which would otherwise false-positive every ordinary Arabic-leading
    // piece that happens to follow a space.
    const leadingChar = firstNonWhitespaceChar(p.text);
    if (pieceLevels[i] % 2 === 1 && (leadingChar === null || !RTL_SCRIPT_RANGE.test(leadingChar))) {
      forceRtl.add(i);
    }
  });

  return { visualRank, forceRtl };
}

function firstNonWhitespaceChar(text: string): string | null {
  for (const ch of text) {
    if (!/\s/.test(ch)) return ch;
  }
  return null;
}

function reverseInPlace(arr: number[], lo: number, hi: number): void {
  while (lo < hi) {
    const tmp = arr[lo];
    arr[lo] = arr[hi];
    arr[hi] = tmp;
    lo++;
    hi--;
  }
}
