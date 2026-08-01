import { useEffect, useRef, useState, useCallback, type RefObject, type FC } from 'react';
import { spellCheckText, ignoreWord, addWordToDictionary } from './spellCheck';
import type { SpellCheckResult } from './spellCheck';

/**
 * Renders as a sibling overlay positioned over an editable page — never as a DOM child of the
 * contenteditable itself, and it never touches that element's `innerHTML`. Underlines are drawn
 * from `Range.getClientRects()` against the live DOM on a debounced timer; the suggestion menu
 * rewrites the misspelled range via `execCommand('insertText', ...)`, which goes through the
 * browser's own undo stack exactly like a real keystroke would, rather than mutating `innerHTML`
 * directly.
 */
interface SpellCheckOverlayProps {
  contentEditableRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  containerRef: RefObject<HTMLElement | null>;
}

interface UnderlinePosition {
  top: number;
  left: number;
  width: number;
  result: SpellCheckResult;
}

interface ContextMenuState {
  x: number;
  y: number;
  result: SpellCheckResult;
}

const DEBOUNCE_MS = 800;

export const SpellCheckOverlay: FC<SpellCheckOverlayProps> = ({ contentEditableRef, enabled, containerRef }) => {
  const [underlines, setUnderlines] = useState<UnderlinePosition[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const computeUnderlines = useCallback(async () => {
    const el = contentEditableRef.current;
    const container = containerRef.current;
    if (!el || !container || !enabled) { setUnderlines([]); return; }

    const text = el.innerText ?? '';
    const results = await spellCheckText(text);
    if (results.length === 0) { setUnderlines([]); return; }

    const containerRect = container.getBoundingClientRect();
    const positions: UnderlinePosition[] = [];

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let charOffset = 0;
    const textNodeMap: { node: Text; start: number; end: number }[] = [];
    let node = walker.nextNode() as Text | null;
    while (node) {
      const length = node.textContent?.length ?? 0;
      textNodeMap.push({ node, start: charOffset, end: charOffset + length });
      charOffset += length;
      node = walker.nextNode() as Text | null;
    }

    for (const result of results) {
      const startNode = textNodeMap.find((n) => result.start >= n.start && result.start < n.end);
      const endNode = textNodeMap.find((n) => result.end > n.start && result.end <= n.end);
      if (!startNode || !endNode) continue;
      try {
        const range = document.createRange();
        range.setStart(startNode.node, result.start - startNode.start);
        range.setEnd(endNode.node, result.end - endNode.start);
        for (const rect of range.getClientRects()) {
          positions.push({
            top: rect.bottom - containerRect.top - 3,
            left: rect.left - containerRect.left,
            width: rect.width,
            result,
          });
        }
      } catch {
        // Stale range against a since-mutated DOM (mid-edit race) — skip this one result,
        // the next debounced pass will recompute against the current DOM.
      }
    }
    setUnderlines(positions);
  }, [contentEditableRef, containerRef, enabled]);

  useEffect(() => {
    if (!enabled) { setUnderlines([]); return; }
    const el = contentEditableRef.current;
    if (!el) return;
    const handleInput = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => { void computeUnderlines(); }, DEBOUNCE_MS);
    };
    el.addEventListener('input', handleInput);
    void computeUnderlines();
    return () => {
      el.removeEventListener('input', handleInput);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [enabled, contentEditableRef, computeUnderlines]);

  useEffect(() => {
    if (!enabled) return;
    const handleReposition = () => { void computeUnderlines(); };
    window.addEventListener('resize', handleReposition, { passive: true });
    const el = contentEditableRef.current;
    el?.addEventListener('scroll', handleReposition, { passive: true });
    return () => {
      window.removeEventListener('resize', handleReposition);
      el?.removeEventListener('scroll', handleReposition);
    };
  }, [enabled, contentEditableRef, computeUnderlines]);

  const handleSuggestionClick = (suggestion: string) => {
    const el = contentEditableRef.current;
    if (!el || !contextMenu) return;
    const result = contextMenu.result;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let charOffset = 0;
    let node = walker.nextNode() as Text | null;
    while (node) {
      const length = node.textContent?.length ?? 0;
      if (charOffset + length > result.start) {
        const range = document.createRange();
        range.setStart(node, result.start - charOffset);
        range.setEnd(node, Math.min(result.end - charOffset, length));
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        document.execCommand('insertText', false, suggestion);
        break;
      }
      charOffset += length;
      node = walker.nextNode() as Text | null;
    }
    setContextMenu(null);
    setTimeout(() => { void computeUnderlines(); }, 100);
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [contextMenu]);

  if (!enabled) return null;

  return (
    <>
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}>
        {underlines.map((u, i) => (
          <div
            key={i}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY, result: u.result });
            }}
            style={{
              position: 'absolute',
              top: u.top,
              left: u.left,
              width: u.width,
              height: 3,
              pointerEvents: 'auto',
              cursor: 'pointer',
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='M0 3 L3 0 L6 3' fill='none' stroke='%23e53e3e' stroke-width='1'/%3E%3C/svg%3E\")",
              backgroundRepeat: 'repeat-x',
              backgroundPosition: 'bottom',
            }}
          />
        ))}
      </div>

      {contextMenu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: 'var(--surface-2, #fff)',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            zIndex: 9999,
            minWidth: 160,
            overflow: 'hidden',
          }}
        >
          {contextMenu.result.suggestions.length > 0
            ? contextMenu.result.suggestions.map((s) => (
              <button
                key={s}
                onMouseDown={() => handleSuggestionClick(s)}
                style={{
                  display: 'block', width: '100%', padding: '8px 16px',
                  textAlign: 'left', fontWeight: 600, background: 'none',
                  border: 'none', cursor: 'pointer',
                  color: 'var(--text-primary, #1a202c)', fontSize: 14,
                }}
              >
                {s}
              </button>
            ))
            : (
              <div style={{ padding: '8px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
                No suggestions
              </div>
            )}
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <button
            onMouseDown={() => {
              if (contextMenu) {
                ignoreWord(contextMenu.result.word);
                setContextMenu(null);
                void computeUnderlines();
              }
            }}
            style={{
              display: 'block', width: '100%', padding: '8px 16px',
              textAlign: 'left', background: 'none', border: 'none',
              cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 13,
            }}
          >
            Ignore
          </button>
          <button
            onMouseDown={() => {
              if (contextMenu) {
                void addWordToDictionary(contextMenu.result.word, contextMenu.result.language).then(() => {
                  setContextMenu(null);
                  void computeUnderlines();
                });
              }
            }}
            style={{
              display: 'block', width: '100%', padding: '8px 16px',
              textAlign: 'left', background: 'none', border: 'none',
              cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 13,
            }}
          >
            Add to dictionary
          </button>
        </div>
      )}
    </>
  );
};
