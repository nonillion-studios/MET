import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { cn } from '../ui/cn';
import type { StudioToolDef } from './toolGroups';

interface ToolFlyoutProps {
  tools: StudioToolDef[];
  activeTool: string;
  orientation: 'vertical' | 'horizontal';
  onPick: (id: string) => void;
  onClose: () => void;
  /** The trigger icon's own element — the flyout is positioned in viewport (`fixed`) coordinates
   *  computed from this rect, not CSS-relative to any ancestor. This is load-bearing: a CSS-relative
   *  (`position: absolute` + `left-full`/`bottom-full`) flyout is a paint-descendant of the tool
   *  rail, so any ancestor with non-`visible` overflow on either axis (a real bug ToolRail.tsx had)
   *  clips or scroll-traps it even though its own viewport-clamp math below is sound in isolation. */
  anchorRef: RefObject<HTMLElement>;
}

/** Screen-edge margin kept clear on every side once the flyout is nudged back into the viewport. */
const VIEWPORT_MARGIN = 6;
/** Gap between the anchor icon and the flyout's near edge. */
const ANCHOR_GAP = 6;

export function ToolFlyout({ tools, activeTool, orientation, onPick, onClose, anchorRef }: ToolFlyoutProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const isVertical = orientation === 'vertical';
  /** Below this many px of room, even a truncated label reads as nothing useful — fall back to the
   *  pre-Fix-3 icon-only row instead of a near-empty sliver. Only bites at genuinely tight layouts
   *  (e.g. the tablet breakpoint's rail sitting close to the right edge); full text is the norm. */
  const MIN_TEXT_WIDTH = 90;
  const [compact, setCompact] = useState(false);

  // Fixed-viewport positioning computed from the anchor icon's own rect — not CSS-relative to any
  // ancestor, so no ancestor's overflow/transform/stacking context can clip or misplace this. First
  // place it on the required side of the anchor (left of vertical, above horizontal — never
  // flipped), then measure the *actual* rendered rect and nudge it back on-screen along the *other*
  // axis only.
  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    el.style.maxWidth = '';
    const anchorRect = anchor.getBoundingClientRect();

    if (isVertical) {
      // Width is content-driven (`w-max`, independent of `left`/`top`), so it's already
      // accurate to measure here, before any inline position styles are set — needed because,
      // unlike opening rightward, placing the flyout to the *left* of the anchor requires
      // knowing its own width up front.
      const naturalWidth = el.getBoundingClientRect().width;
      el.style.left = `${anchorRect.left - naturalWidth - ANCHOR_GAP}px`;
      el.style.top = `${anchorRect.top}px`;
      el.style.bottom = '';
    } else {
      el.style.left = `${anchorRect.left}px`;
      el.style.bottom = `${window.innerHeight - anchorRect.top + ANCHOR_GAP}px`;
      el.style.top = '';
    }

    const rect = el.getBoundingClientRect();

    if (isVertical) {
      let top = rect.top;
      if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) top -= rect.bottom - (window.innerHeight - VIEWPORT_MARGIN);
      if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
      el.style.top = `${top}px`;

      // Required side (left of a vertical rail) is never flipped, so a rail sitting close to the
      // left edge of its container (a narrow/tablet layout) can leave less room than the
      // full-text row wants.
      const availableWidth = anchorRect.left - ANCHOR_GAP - VIEWPORT_MARGIN;
      if (!compact && rect.width > availableWidth && availableWidth < MIN_TEXT_WIDTH) {
        setCompact(true);
        return; // re-render as icon-only, then re-measure/re-clamp on the next effect pass
      }
      const width = Math.min(rect.width, Math.max(0, availableWidth));
      if (rect.width > availableWidth) el.style.maxWidth = `${Math.max(0, availableWidth)}px`;
      let left = anchorRect.left - width - ANCHOR_GAP;
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
      el.style.left = `${left}px`;
    } else {
      let left = rect.left;
      if (rect.right > window.innerWidth - VIEWPORT_MARGIN) left -= rect.right - (window.innerWidth - VIEWPORT_MARGIN);
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
      el.style.left = `${left}px`;
    }
  }, [isVertical, tools.length, compact, anchorRef]);

  return (
    <div
      ref={ref}
      className={cn(
        'fixed z-50 liquid-glass-heavy rounded-panel border border-hairline p-1 flex gap-0.5',
        compact ? 'flex-col' : 'flex-col w-max max-w-[200px]'
      )}
    >
      {/* Rows always stack vertically regardless of which edge the flyout itself pops from — a
          horizontal strip of "icon + name + shortcut" chips would be unreadably wide, and the
          rail's own orientation only needs to decide which side the popup opens on. `compact` is
          the tight-viewport fallback to the pre-Fix-3 icon-only row — see the layout effect above. */}
      {tools.map(tool => {
        const Icon = tool.icon;
        const label = tool.enabled ? tool.label : `${tool.label} (coming soon)`;
        const titleText = tool.enabled ? `${tool.label}${tool.shortcut ? ` (${tool.shortcut.toUpperCase()})` : ''}` : `${tool.label} — coming soon`;
        const activeClass = activeTool === tool.id
          ? 'bg-accent-soft border-accent/30 text-accent'
          : 'bg-transparent border-transparent text-ink hover:bg-ink/10';
        return (
          <button
            key={tool.id}
            disabled={!tool.enabled}
            aria-label={label}
            title={titleText}
            onClick={() => { onPick(tool.id); onClose(); }}
            className={cn(
              'flex items-center rounded-control border transition-colors duration-150',
              'disabled:opacity-40 disabled:pointer-events-none',
              activeClass,
              compact ? 'w-8 h-8 justify-center shrink-0' : 'gap-2.5 px-2 py-1.5 text-left min-w-0'
            )}
          >
            <Icon size={16} className="shrink-0" />
            {!compact && (
              <>
                <span className="text-micro truncate min-w-0">{tool.label}</span>
                {tool.shortcut && (
                  <span className="text-micro text-ink-faint ml-auto pl-3 font-mono uppercase shrink-0">{tool.shortcut}</span>
                )}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
