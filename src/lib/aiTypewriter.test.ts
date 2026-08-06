import { describe, it, expect } from 'vitest';
import { tokenizeMarkup } from './aiTypewriter';

describe('tokenizeMarkup', () => {
  it('produces a single text token for plain text', () => {
    expect(tokenizeMarkup('Hello there')).toEqual([{ type: 'text', value: 'Hello there' }]);
  });

  it('wraps bold runs in start/end tokens around their own text', () => {
    expect(tokenizeMarkup('Get **out** now')).toEqual([
      { type: 'text', value: 'Get ' },
      { type: 'bold-start' },
      { type: 'text', value: 'out' },
      { type: 'bold-end' },
      { type: 'text', value: ' now' },
    ]);
  });

  it('wraps italic runs marked with double slashes', () => {
    expect(tokenizeMarkup('//whoosh//')).toEqual([
      { type: 'italic-start' },
      { type: 'text', value: 'whoosh' },
      { type: 'italic-end' },
    ]);
  });

  it('emits a newline token for a single line break within a paragraph', () => {
    expect(tokenizeMarkup('Line one\nLine two')).toEqual([
      { type: 'text', value: 'Line one' },
      { type: 'newline' },
      { type: 'text', value: 'Line two' },
    ]);
  });

  it('emits a paragraph-break for a blank line between bubbles', () => {
    expect(tokenizeMarkup('Bubble one\n\nBubble two')).toEqual([
      { type: 'text', value: 'Bubble one' },
      { type: 'paragraph-break' },
      { type: 'text', value: 'Bubble two' },
    ]);
  });

  it('handles multiple bold/italic runs on the same line in order', () => {
    expect(tokenizeMarkup('**A** and //B// and **C**')).toEqual([
      { type: 'bold-start' }, { type: 'text', value: 'A' }, { type: 'bold-end' },
      { type: 'text', value: ' and ' },
      { type: 'italic-start' }, { type: 'text', value: 'B' }, { type: 'italic-end' },
      { type: 'text', value: ' and ' },
      { type: 'bold-start' }, { type: 'text', value: 'C' }, { type: 'bold-end' },
    ]);
  });

  it('returns no tokens for an empty string', () => {
    expect(tokenizeMarkup('')).toEqual([]);
  });
});
