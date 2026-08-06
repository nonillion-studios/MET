export type MarkupToken =
  | { type: 'text'; value: string }
  | { type: 'bold-start' | 'bold-end' | 'italic-start' | 'italic-end' | 'newline' | 'paragraph-break' };

/** Splits a single line on `**bold**`/`//italic//` markers, preserving order. Pure — no DOM. */
function tokenizeLine(line: string): MarkupToken[] {
  const tokens: MarkupToken[] = [];
  const re = /\*\*(.+?)\*\*|\/\/(.+?)\/\//g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: line.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ type: 'bold-start' }, { type: 'text', value: match[1] }, { type: 'bold-end' });
    } else if (match[2] !== undefined) {
      tokens.push({ type: 'italic-start' }, { type: 'text', value: match[2] }, { type: 'italic-end' });
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < line.length) {
    tokens.push({ type: 'text', value: line.slice(lastIndex) });
  }
  return tokens;
}

/** Parses a Gemini translation reply (see `geminiTranslate.ts`'s `buildInstructions`) into a flat
 *  token stream: a blank line separates bubbles/captions (`paragraph-break`), a single line break
 *  is a `newline`, and `**...**`/`//...//` runs become bold/italic start-end pairs around their own
 *  text tokens. Pure function — no DOM — so it's covered by a plain unit test rather than e2e. */
export function tokenizeMarkup(markup: string): MarkupToken[] {
  const tokens: MarkupToken[] = [];
  const paragraphs = markup.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  paragraphs.forEach((para, pIdx) => {
    if (pIdx > 0) tokens.push({ type: 'paragraph-break' });
    const lines = para.split('\n');
    lines.forEach((line, lIdx) => {
      if (lIdx > 0) tokens.push({ type: 'newline' });
      tokens.push(...tokenizeLine(line));
    });
  });
  return tokens;
}

export interface TypewriterHandle {
  cancelled: boolean;
  cancel: () => void;
}

export function createTypewriterHandle(): TypewriterHandle {
  const handle: TypewriterHandle = { cancelled: false, cancel: () => { handle.cancelled = true; } };
  return handle;
}

function tick(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export interface TypeMarkupOptions {
  /** Characters inserted per animation tick — higher reads as "typing fast." */
  charsPerTick?: number;
  tickMs?: number;
  /** Insert a paragraph break before the first token, to separate this page's translation from
   *  whatever already ends the document (skipped when the target page is still empty). */
  leadingParagraphBreak?: boolean;
  /** Fires after every insertion step — callers can use it to nudge scroll position, etc. */
  onTick?: () => void;
}

/** Drives real `document.execCommand` calls on a contentEditable page to visually "type" a
 *  translation — bold/italic are applied by actually toggling those commands around marked runs
 *  (the same tool a human would reach for), not by injecting pre-styled HTML. `getEl` is re-called
 *  before every single insertion step (not just once) and the caret is re-placed at its end each
 *  time — this app's pagination (`TextEditorPage.tsx`'s `reflow()`) can relocate trailing content to
 *  a freshly-created page mid-stroke on a normal `input` event, so trusting a single stale element
 *  reference (or assuming focus follows the moved content) isn't safe; always resolving "the current
 *  last page, freshly" is what stays correct regardless of how reflow moved things around. */
export async function typeMarkupIntoElement(
  getEl: () => HTMLElement | null,
  markup: string,
  handle: TypewriterHandle,
  opts: TypeMarkupOptions = {},
): Promise<void> {
  const { charsPerTick = 2, tickMs = 16, leadingParagraphBreak = false, onTick } = opts;
  if (!markup.trim()) return;

  const firstEl = getEl();
  if (!firstEl) return;
  if (leadingParagraphBreak && firstEl.textContent && firstEl.textContent.trim().length > 0) {
    firstEl.focus();
    placeCaretAtEnd(firstEl);
    document.execCommand('insertParagraph');
  }

  const tokens = tokenizeMarkup(markup);
  let boldOn = false;
  let italicOn = false;

  async function insertStep(run: () => void) {
    if (handle.cancelled) return;
    const el = getEl();
    if (!el) return;
    el.focus();
    placeCaretAtEnd(el);
    run();
    onTick?.();
    await tick(tickMs);
  }

  for (const token of tokens) {
    if (handle.cancelled) break;
    switch (token.type) {
      case 'bold-start':
        if (!boldOn) { await insertStep(() => document.execCommand('bold')); boldOn = true; }
        break;
      case 'bold-end':
        if (boldOn) { await insertStep(() => document.execCommand('bold')); boldOn = false; }
        break;
      case 'italic-start':
        if (!italicOn) { await insertStep(() => document.execCommand('italic')); italicOn = true; }
        break;
      case 'italic-end':
        if (italicOn) { await insertStep(() => document.execCommand('italic')); italicOn = false; }
        break;
      case 'newline':
        await insertStep(() => document.execCommand('insertLineBreak'));
        break;
      case 'paragraph-break':
        if (boldOn) { await insertStep(() => document.execCommand('bold')); boldOn = false; }
        if (italicOn) { await insertStep(() => document.execCommand('italic')); italicOn = false; }
        await insertStep(() => document.execCommand('insertParagraph'));
        break;
      case 'text': {
        const text = token.value;
        for (let i = 0; i < text.length; i += charsPerTick) {
          if (handle.cancelled) break;
          const chunk = text.slice(i, i + charsPerTick);
          await insertStep(() => document.execCommand('insertText', false, chunk));
        }
        break;
      }
    }
  }

  if (boldOn) await insertStep(() => document.execCommand('bold'));
  if (italicOn) await insertStep(() => document.execCommand('italic'));
}
