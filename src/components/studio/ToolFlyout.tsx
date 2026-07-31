import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../ui/cn';
import type { StudioToolDef } from './toolGroups';

interface ToolFlyoutProps {
  tools: StudioToolDef[];
  activeTool: string;
  orientation: 'vertical' | 'horizontal';
  onPick: (id: string) => void;
  onClose: () => void;
}

/** Screen-edge margin kept clear on every side once the flyout is nudged back into the viewport. */
const VIEWPORT_MARGIN = 6;

export function ToolFlyout({ tools, activeTool, orientation, onPick, onClose }: ToolFlyoutProps) {
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

  // Viewport clamping: the flyout is CSS-positioned (left-full/bottom-full) relative to its own
  // icon, which keeps it correctly on the required side of the rail (right of vertical, above
  // horizontal) but doesn't know about the screen edges. Measure the *actual* rendered rect (real
  // Tailwind-computed layout, not a hand-estimated one that could silently drift from the classes
  // above) and nudge it back on-screen along the *other* axis only — it must never flip which side
  // it opens on.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
    el.style.maxWidth = '';
    const rect = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (isVertical) {
      if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) dy = window.innerHeight - VIEWPORT_MARGIN - rect.bottom;
      if (rect.top + dy < VIEWPORT_MARGIN) dy = VIEWPORT_MARGIN - rect.top;
      // Required side (right of a vertical rail) is never flipped, so a rail sitting close to the
      // right edge (a narrow/tablet layout) can leave less room than the full-text row wants.
      const availableWidth = window.innerWidth - VIEWPORT_MARGIN - rect.left;
      if (!compact && rect.width > availableWidth && availableWidth < MIN_TEXT_WIDTH) {
        setCompact(true);
        return; // re-render as icon-only, then re-measure/re-clamp on the next effect pass
      }
      if (rect.width > availableWidth) el.style.maxWidth = `${Math.max(0, availableWidth)}px`;
    } else {
      if (rect.right > window.innerWidth - VIEWPORT_MARGIN) dx = window.innerWidth - VIEWPORT_MARGIN - rect.right;
      if (rect.left + dx < VIEWPORT_MARGIN) dx = VIEWPORT_MARGIN - rect.left;
    }
    if (dx || dy) el.style.transform = `translate(${dx}px, ${dy}px)`;
  }, [isVertical, tools.length, compact]);

  return (
    <div
      ref={ref}
      className={cn(
        'absolute z-50 liquid-glass-heavy rounded-panel border border-hairline p-1 flex gap-0.5',
        isVertical ? 'left-full top-0 ml-1.5' : 'bottom-full left-0 mb-1.5',
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
