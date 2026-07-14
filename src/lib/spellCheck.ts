/**
 * A small starter misspelling dictionary (English + Arabic common mistakes), not a full
 * language dictionary — flags exact-word matches only. Real dictionary-backed spell/grammar
 * checking is out of scope for a browser-only app without a server; this gives the
 * click-to-fix workflow SPEC asks for on a realistic, honestly-scoped word list.
 */
export const COMMON_MISSPELLINGS: Record<string, string> = {
  teh: 'the',
  recieve: 'receive',
  seperate: 'separate',
  definately: 'definitely',
  occured: 'occurred',
  untill: 'until',
  wich: 'which',
  becuase: 'because',
  writen: 'written',
  freind: 'friend',
  goverment: 'government',
  neccessary: 'necessary',
  publically: 'publicly',
  wierd: 'weird',
  اكيد: 'أكيد',
  ايضا: 'أيضًا',
  لاكن: 'لكن',
  انشاء: 'إنشاء',
  هاذا: 'هذا',
};

export interface SpellIssue {
  word: string;
  fix: string;
  start: number;
  end: number;
}

/** Finds misspelled words in plain text. Word boundaries are simple whitespace/punctuation splits. */
export function findSpellIssues(text: string): SpellIssue[] {
  const issues: SpellIssue[] = [];
  const re = /[\p{L}\p{M}]+/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const word = match[0];
    const fix = COMMON_MISSPELLINGS[word.toLowerCase()] ?? COMMON_MISSPELLINGS[word];
    if (fix) issues.push({ word, fix, start: match.index, end: match.index + word.length });
  }
  return issues;
}

/** Wraps every flagged word in a clickable `<span class="spell-miss" data-fix="...">` for click-to-fix editing. */
export function markMisspellings(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) textNodes.push(node as Text);

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? '';
    const issues = findSpellIssues(text);
    if (issues.length === 0) continue;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const issue of issues) {
      if (issue.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, issue.start)));
      const span = document.createElement('span');
      span.className = 'spell-miss';
      span.dataset.fix = issue.fix;
      span.title = `Did you mean "${issue.fix}"?`;
      span.textContent = issue.word;
      frag.appendChild(span);
      cursor = issue.end;
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  return container.innerHTML;
}

/** Strips spell-check marker spans back to plain text content — always run before export/send. */
export function stripSpellMarks(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll('.spell-miss').forEach((el) => {
    el.replaceWith(document.createTextNode(el.textContent ?? ''));
  });
  return container.innerHTML;
}
