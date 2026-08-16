import { describe, it, expect } from 'vitest';
import { resolveLineBidi, wrapForcedRtl } from './textBidi';

describe('resolveLineBidi', () => {
  it('identity order, no forceRtl for plain Latin content', () => {
    const { visualRank, forceRtl } = resolveLineBidi([{ text: 'Hello ' }, { text: 'World' }]);
    expect(visualRank).toEqual([0, 1]);
    expect(forceRtl.size).toBe(0);
  });

  it('is a no-op for a single piece regardless of script (nothing to reorder)', () => {
    const { visualRank, forceRtl } = resolveLineBidi([{ text: 'مرحبا بالعالم' }]);
    expect(visualRank).toEqual([0]);
    expect(forceRtl.size).toBe(0);
  });

  it('reverses two pieces split by a style boundary (typed order Arabic, then embedded Latin)', () => {
    // Simulates a TextRun style override splitting otherwise-uniform RTL content: the Arabic piece
    // was typed first but should render to the right of the embedded Latin word.
    const { visualRank } = resolveLineBidi([{ text: 'الجملة ' }, { text: 'Hello' }]);
    expect(visualRank[0]).toBeGreaterThan(visualRank[1]);
    expect(visualRank).toEqual([1, 0]);
  });

  it('reverses a 3-piece line with a Latin word embedded between two Arabic pieces', () => {
    const { visualRank } = resolveLineBidi([
      { text: 'الجملة ' },
      { text: 'Hello ' },
      { text: 'التالية' },
    ]);
    // Typed order reversed: first-typed piece ends up rightmost (highest rank), last-typed leftmost.
    expect(visualRank).toEqual([2, 1, 0]);
  });

  it('flags a bare digit/punctuation piece (own leading/trailing space, no strong char) for forced-direction wrapping', () => {
    const { forceRtl } = resolveLineBidi([{ text: 'صفحة' }, { text: ' 5 ' }, { text: 'التالية' }]);
    expect(forceRtl.has(1)).toBe(true);
    // The Arabic pieces themselves already have a strong RTL leading character — no forcing needed.
    expect(forceRtl.has(0)).toBe(false);
    expect(forceRtl.has(2)).toBe(false);
  });

  it('does not false-positive forceRtl on an Arabic piece whose text happens to start with a space', () => {
    // wrapParagraph re-attaches a wrap token's separator space to its start — a piece literally
    // starting with ' ' before Arabic letters must not be mistaken for "no strong character". Here
    // the digit piece itself resolves to an even (LTR-context) level since the adjacent pieces carry
    // the surrounding spaces, so nothing needs forcing at all.
    const { forceRtl } = resolveLineBidi([{ text: 'صفحة ' }, { text: '5' }, { text: ' التالية' }]);
    expect(forceRtl.size).toBe(0);
  });
});

describe('wrapForcedRtl', () => {
  it('wraps text in the RLE/RLM embedding markers', () => {
    expect(wrapForcedRtl('5')).toBe('‫5‏');
  });
});
