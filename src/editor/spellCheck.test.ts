import { describe, it, expect } from 'vitest';
import { levenshteinDistance, rankSuggestions } from './spellCheck';

describe('levenshteinDistance', () => {
  it('is 0 for identical strings', () => {
    expect(levenshteinDistance('the', 'the')).toBe(0);
  });

  it('counts a single substitution', () => {
    expect(levenshteinDistance('teh', 'the')).toBe(2);
  });

  it('counts insertions/deletions', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
    expect(levenshteinDistance('cats', 'cat')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });
});

describe('rankSuggestions', () => {
  it('sorts by ascending edit distance from the original word', () => {
    // 'wold' is one deletion away from 'wrold' (distance 1); 'world'/'word' are both distance 2 —
    // 'wold' must rank first regardless of the tied pair's relative order.
    const ranked = rankSuggestions('wrold', ['world', 'word', 'wold']);
    expect(ranked[0]).toBe('wold');
    expect(ranked.slice(1)).toEqual(expect.arrayContaining(['world', 'word']));
  });

  it('filters out suggestions much longer than the original', () => {
    const ranked = rankSuggestions('cat', ['cats', 'catastrophe']);
    expect(ranked).toContain('cats');
    expect(ranked).not.toContain('catastrophe');
  });

  it('caps results at 5', () => {
    const ranked = rankSuggestions('teh', ['the', 'ten', 'tea', 'ted', 'tex', 'tex2', 'tex3']);
    expect(ranked.length).toBeLessThanOrEqual(5);
  });
});
