import { describe, it, expect } from 'vitest';
import { layoutText, measureRunText, AUTO_FIT_HEIGHT_BUFFER } from './textLayout';
import { DEFAULT_TEXT_SHADOW, DEFAULT_TEXT_GRADIENT, type TextLayerData } from './studioTypes';

/** Mirrors createTextLayer's defaults (studioTypes.ts) minus x/y/width, which each test sets. */
function makeText(overrides: Partial<TextLayerData> = {}): TextLayerData {
  return {
    content: '',
    x: 0,
    y: 0,
    width: 200,
    autoWidth: false,
    textMode: 'area',
    letterSpacing: 0,
    shadow: { ...DEFAULT_TEXT_SHADOW },
    gradient: { ...DEFAULT_TEXT_GRADIENT },
    runs: [],
    fontFamily: 'Arial',
    fontSize: 20,
    color: '#000000',
    align: 'left',
    bold: false,
    italic: false,
    underline: false,
    lineHeight: 1.15,
    strokeColor: '#ffffff',
    strokeWidth: 0,
    rotation: 0,
    status: 'draft',
    comment: '',
    ...overrides,
  };
}

const lineStep = (text: TextLayerData) => text.fontSize * text.lineHeight;

describe('layoutText overflow', () => {
  it('does not overflow when content fits within fixedHeight', () => {
    const text = makeText({ content: 'One short line', fixedHeight: 200 });
    const layout = layoutText(text);
    expect(layout.overflowing).toBe(false);
  });

  it('overflows when content exceeds fixedHeight', () => {
    const text = makeText({ content: 'Line one\nLine two\nLine three\nLine four\nLine five', fixedHeight: 30 });
    const layout = layoutText(text);
    expect(layout.overflowing).toBe(true);
  });

  it('does not overflow exactly at the threshold (naturalHeight === fixedHeight)', () => {
    const text = makeText({ content: 'Just one line' });
    const natural = layoutText(text).height;
    const atThreshold = layoutText({ ...text, fixedHeight: natural });
    expect(atThreshold.overflowing).toBe(false);
  });

  it('point text (autoWidth) never overflows regardless of fixedHeight or content length', () => {
    const longContent = Array.from({ length: 50 }, (_, i) => `Line ${i}`).join('\n');
    const text = makeText({ content: longContent, autoWidth: true, fixedHeight: 10 });
    const layout = layoutText(text);
    expect(layout.overflowing).toBe(false);
  });

  it('never overflows when fixedHeight is not set', () => {
    const longContent = Array.from({ length: 50 }, (_, i) => `Line ${i}`).join('\n');
    const text = makeText({ content: longContent });
    const layout = layoutText(text);
    expect(layout.overflowing).toBe(false);
  });

  it('flips overflowing live as fixedHeight shrinks or grows (purely derived, never stale)', () => {
    const text = makeText({ content: 'Line one\nLine two\nLine three' });
    const natural = layoutText(text).height;

    const shrunk = layoutText({ ...text, fixedHeight: natural - 1 });
    expect(shrunk.overflowing).toBe(true);

    const grown = layoutText({ ...text, fixedHeight: natural + 1 });
    expect(grown.overflowing).toBe(false);
  });

  it('flips overflowing when fontSize grows past the threshold', () => {
    const text = makeText({ content: 'Line one\nLine two\nLine three', fontSize: 12 });
    const naturalAtSmall = layoutText(text).height;
    const fitsAtSmall = layoutText({ ...text, fixedHeight: naturalAtSmall });
    expect(fitsAtSmall.overflowing).toBe(false);

    const biggerFont = { ...text, fontSize: 40, fixedHeight: naturalAtSmall };
    expect(layoutText(biggerFont).overflowing).toBe(true);
  });

  it('height is independent of fixedHeight — the exact auto-fit contract', () => {
    const text = makeText({ content: 'Line one\nLine two\nLine three\nLine four', fixedHeight: 20 });
    const naturalWithSmallFrame = layoutText(text).height;
    const naturalWithNoFrame = layoutText({ ...text, fixedHeight: undefined }).height;
    expect(naturalWithSmallFrame).toBe(naturalWithNoFrame);
    expect(naturalWithSmallFrame).toBe(Math.max(1, 4) * lineStep(text));
  });

  it('feeding layoutText(text).height back in as fixedHeight makes overflowing false next time', () => {
    const text = makeText({ content: 'Line one\nLine two\nLine three', fixedHeight: 10 });
    expect(layoutText(text).overflowing).toBe(true);

    const fitted = layoutText(text).height;
    const autoFit = { ...text, fixedHeight: fitted };
    expect(layoutText(autoFit).overflowing).toBe(false);
  });
});

describe('layoutText width', () => {
  it('box text (autoWidth false) stays pinned to its authored width when content fits', () => {
    const text = makeText({ content: 'A short line that fits easily', width: 300, autoWidth: false });
    expect(layoutText(text).width).toBe(300);
  });

  it('an unbreakable token (no spaces of its own) wider than the box wraps character-by-character instead of overflowing', () => {
    const text = makeText({
      content: 'ThisIsOneUnbreakablyLongTokenThatCannotWrapToFitTheBox',
      width: 50,
      autoWidth: false,
    });
    const layout = layoutText(text);
    // Stays pinned to the authored width — the old behavior let this grow past it instead.
    expect(layout.width).toBe(50);
    expect(layout.lines.length).toBeGreaterThan(1);
  });

  it('point text (autoWidth true) width equals the full measured line width', () => {
    const text = makeText({ content: 'Hello how are you today my friend', autoWidth: true });
    const layout = layoutText(text);
    const style = { fontFamily: text.fontFamily, fontSize: text.fontSize, fontWeight: 400, color: text.color, italic: false, underline: false, letterSpacing: 0, kerning: 0, baselineShift: 0 };
    expect(layout.width).toBeCloseTo(measureRunText(text.content, style), 5);
  });

  it('a long sentence in a narrow box actually wraps into multiple lines, none wider than the box', () => {
    const text = makeText({
      content: 'hello how is everything going today my good friend',
      width: 120,
      autoWidth: false,
    });
    const layout = layoutText(text);
    expect(layout.lines.length).toBeGreaterThan(1);
    // Every wrapped line's own rendered width stays within the box — no single line runs past the
    // right edge the way un-wrapped single-line text would.
    for (const line of layout.lines) {
      const runsOnLine = layout.runs.filter(r => r.y === line.y);
      const lineWidth = runsOnLine.reduce((max, r) => Math.max(max, r.x + measureRunText(r.drawText ?? r.text, r.style)), 0);
      expect(lineWidth).toBeLessThanOrEqual(text.width);
    }
  });

  it('a continuous string with no spaces at all still wraps into multiple lines, content preserved', () => {
    // Mirrors the real repro: typing a long run of characters with no spaces into an area box —
    // greedy word-wrap alone has nowhere to break this, so it must fall back to a character split.
    const content = 'AWRARAGRGAAWERAWRARAGRGAAQWERTYUIOPASDFGHJKL';
    const text = makeText({ content, width: 100, autoWidth: false });
    const layout = layoutText(text);

    expect(layout.width).toBe(100);
    expect(layout.lines.length).toBeGreaterThan(1);

    // Every wrapped line stays within the box, same contract as the word-wrap case above.
    for (const line of layout.lines) {
      const runsOnLine = layout.runs.filter(r => r.y === line.y);
      const lineWidth = runsOnLine.reduce((max, r) => Math.max(max, r.x + measureRunText(r.drawText ?? r.text, r.style)), 0);
      expect(lineWidth).toBeLessThanOrEqual(text.width);
    }

    // No characters dropped or duplicated at the character-split points — concatenating every
    // run's text back in order reconstructs the original content exactly.
    expect(layout.runs.map(r => r.text).join('')).toBe(content);
  });
});

describe('layoutText content immutability', () => {
  it('never mutates the content string it was given, however it wraps/overflows/auto-fits', () => {
    const content = 'hello how is everything going today my good friend\nsecond paragraph, unchanged too';
    const text = makeText({ content, width: 80, fixedHeight: 30, autoFitFontSize: true });
    const before = text.content;
    layoutText(text);
    // Same reference, not just equal value — layoutText must not have replaced the string at all.
    expect(text.content).toBe(before);
    expect(text.content).toBe(content);
  });
});

describe('layoutText auto-fit font size', () => {
  const fourLines = 'Line one\nLine two\nLine three\nLine four';

  it('leaves non-auto-fit text byte-identical: resolvedFontSize is the stored fontSize, overflow still happens', () => {
    const text = makeText({ content: fourLines, fontSize: 40, fixedHeight: 60 });
    const layout = layoutText(text);
    expect(layout.resolvedFontSize).toBe(40);
    expect(layout.overflowing).toBe(true);
  });

  it('adding fixedHeight alone (no autoFitFontSize) does not trigger the search', () => {
    const text = makeText({ content: fourLines, fontSize: 40, fixedHeight: 60, autoFitFontSize: false });
    expect(layoutText(text).resolvedFontSize).toBe(40);
  });

  it('is a no-op for point text (autoWidth), even with fixedHeight and autoFitFontSize both set', () => {
    const text = makeText({ content: fourLines, fontSize: 40, autoWidth: true, fixedHeight: 60, autoFitFontSize: true });
    const layout = layoutText(text);
    expect(layout.resolvedFontSize).toBe(40);
  });

  it('search converges to a fontSize that fits — shrinks below the ceiling and clears overflow', () => {
    const text = makeText({ content: fourLines, fontSize: 40, fixedHeight: 60, autoFitFontSize: true });
    const layout = layoutText(text);
    expect(layout.overflowing).toBe(false);
    expect(layout.resolvedFontSize).toBeLessThan(40);
    // 8% buffer: auto-fit tolerates text slightly taller than the fixed frame (curved
    // speech-bubble edges have real slack there) rather than shrinking tighter than it needs to.
    expect(layout.height).toBeLessThanOrEqual(60 * AUTO_FIT_HEIGHT_BUFFER);
  });

  it('respects the ceiling: content that already fits at the authored fontSize never grows or shrinks', () => {
    const text = makeText({ content: 'One short line', fontSize: 20, fixedHeight: 200, autoFitFontSize: true });
    const layout = layoutText(text);
    expect(layout.resolvedFontSize).toBe(20);
    expect(layout.overflowing).toBe(false);
  });

  it('respects the floor: still overflows at the minimum size when the frame is too small for any size', () => {
    const text = makeText({ content: fourLines, fontSize: 40, fixedHeight: 5, autoFitFontSize: true });
    const layout = layoutText(text);
    expect(layout.resolvedFontSize).toBe(6);
    expect(layout.overflowing).toBe(true);
  });
});

describe('layoutText bidi reordering', () => {
  it('reorders a style-split RTL line visually while keeping runs[] in original logical/typed order', () => {
    const arabic = 'الجملة ';
    const latin = 'Hello';
    // Two TextRuns (different style overrides) so paragraphsOf produces two separate LinePieces on
    // one line, simulating a bold/italic override splitting otherwise-uniform RTL content — the
    // actual trigger for this bug (see textLayout.ts's bidi-resolution comment).
    const text = makeText({
      content: arabic + latin,
      autoWidth: true,
      runs: [
        { length: arabic.length },
        { length: latin.length, bold: true },
      ],
    });
    const layout = layoutText(text);

    // runs[] stays in logical/typed order — critical for autoTypeset.ts's linesFromLayout, which
    // concatenates run.text in array order to reconstruct line content.
    expect(layout.runs.map(r => r.text)).toEqual([arabic, latin]);

    // But visually, the Arabic piece (typed first, read right-to-left) sits to the RIGHT of the
    // embedded Latin word rather than simply "after" it in typed/x order.
    const [arabicRun, latinRun] = layout.runs;
    expect(arabicRun.x).toBeGreaterThan(latinRun.x);
  });

  it('leaves plain Latin content completely untouched (identity fast path)', () => {
    const text = makeText({
      content: 'Hello World',
      autoWidth: true,
      runs: [{ length: 6 }, { length: 5, bold: true }],
    });
    const layout = layoutText(text);
    expect(layout.runs.map(r => r.text)).toEqual(['Hello ', 'World']);
    expect(layout.runs[0].x).toBeLessThan(layout.runs[1].x);
    expect(layout.runs.every(r => r.drawText === undefined)).toBe(true);
  });
});

describe('layoutText verticalAlign', () => {
  it('defaults to top (unaffected) when verticalAlign is absent', () => {
    const text = makeText({ content: 'One line', fixedHeight: 200 });
    const layout = layoutText(text);
    expect(layout.runs[0].y).toBe(0);
    expect(layout.firstBaselineY).toBe(text.fontSize * 0.8);
  });

  it('top is explicitly a no-op too', () => {
    const text = makeText({ content: 'One line', fixedHeight: 200, verticalAlign: 'top' });
    expect(layoutText(text).runs[0].y).toBe(0);
  });

  it('middle centers the natural content height within fixedHeight', () => {
    const text = makeText({ content: 'One line', fixedHeight: 200, verticalAlign: 'middle' });
    const natural = layoutText({ ...text, fixedHeight: undefined }).height;
    const layout = layoutText(text);
    const expectedOffset = (200 - natural) / 2;
    expect(layout.runs[0].y).toBeCloseTo(expectedOffset, 5);
    expect(layout.firstBaselineY).toBeCloseTo(text.fontSize * 0.8 + expectedOffset, 5);
  });

  it('bottom anchors the natural content height to the frame\'s bottom edge', () => {
    const text = makeText({ content: 'One line', fixedHeight: 200, verticalAlign: 'bottom' });
    const natural = layoutText({ ...text, fixedHeight: undefined }).height;
    const layout = layoutText(text);
    expect(layout.runs[0].y).toBeCloseTo(200 - natural, 5);
  });

  it('clamps to 0 rather than pushing content off-screen when content overflows the frame', () => {
    const text = makeText({
      content: 'Line one\nLine two\nLine three\nLine four',
      fixedHeight: 20,
      verticalAlign: 'middle',
    });
    const layout = layoutText(text);
    expect(layout.overflowing).toBe(true);
    expect(layout.runs[0].y).toBe(0);
  });

  it('has no effect without a fixedHeight, or for point text', () => {
    const noFrame = makeText({ content: 'One line', verticalAlign: 'middle' });
    expect(layoutText(noFrame).runs[0].y).toBe(0);

    const pointText = makeText({ content: 'One line', autoWidth: true, fixedHeight: 200, verticalAlign: 'middle' });
    expect(layoutText(pointText).runs[0].y).toBe(0);
  });

  it('reported height stays the natural content height regardless of verticalAlign', () => {
    const top = makeText({ content: 'One line', fixedHeight: 200, verticalAlign: 'top' });
    const middle = { ...top, verticalAlign: 'middle' as const };
    const bottom = { ...top, verticalAlign: 'bottom' as const };
    const naturalHeight = layoutText({ ...top, fixedHeight: undefined }).height;
    expect(layoutText(top).height).toBe(naturalHeight);
    expect(layoutText(middle).height).toBe(naturalHeight);
    expect(layoutText(bottom).height).toBe(naturalHeight);
  });
});
