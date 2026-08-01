/**
 * The from-scratch EN+AR misspelling dictionary that used to live here (`COMMON_MISSPELLINGS`,
 * `markMisspellings`/`markMisspellingsLive`, wrapping flagged words in `.spell-miss` spans) is
 * gone — superseded by the real Hunspell-backed checker in `src/editor/spellCheck.ts` +
 * `SpellCheckOverlay.tsx`, which never touches a page's `innerHTML` at all (it draws underlines
 * as a sibling overlay instead of marking spans in place). `stripSpellMarks` survives here as a
 * defensive cleanup for any `.spell-miss` markup persisted by a document saved before this change.
 */

/** Strips spell-check marker spans back to plain text content — always run before export/send. */
export function stripSpellMarks(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll('.spell-miss').forEach((el) => {
    el.replaceWith(document.createTextNode(el.textContent ?? ''));
  });
  return container.innerHTML;
}
