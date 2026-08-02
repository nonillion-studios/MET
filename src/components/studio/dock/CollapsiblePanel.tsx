import { useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal } from 'lucide-react';
import { IconButton } from '../../ui';
import { cn } from '../../ui/cn';
import { swal } from '../../../lib/swalTheme';

/** Extra, panel-specific actions folded into the same combined menu the universal Close/Reset
 *  Height items render in — e.g. Layers' New Layer/New Blank Layer/Flatten/Merge Visible. Plain
 *  data (not a callback that opens its own separate dialog), so there's exactly one menu
 *  implementation for every panel, not one generic one plus a handful of bespoke ones. */
export interface PanelMenuItem {
  label: string;
  onSelect: () => void;
}

interface CollapsiblePanelProps {
  id: string;
  title: string;
  children: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  maximized: boolean;
  onToggleMaximized: () => void;
  /** The Layers panel: fills remaining column space with its own internal scroll while expanded,
   *  instead of a stored height — it can still be collapsed/expanded like any other panel, just
   *  via a plain instant swap between the two layouts rather than an animated height transition. */
  grow?: boolean;
  /** Explicit stored height in px (absent for `grow` panels, which don't have one). */
  height?: number;
  onClose: () => void;
  onResetHeight: () => void;
  menuItems?: PanelMenuItem[];
  draggedOver: 'above' | 'below' | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverHeader: (before: boolean) => void;
  onDropOnHeader: () => void;
}

/** Real double-click-to-maximize on the same header a single click collapses/expands needs to tell
 *  the two apart — a double-click still fires two ordinary `click` events first, per the DOM spec,
 *  so a naive `onClick` would toggle collapse twice (a visible flicker) before `onDoubleClick` ever
 *  fires. Debouncing the single-click action lets a fast second click cancel it outright. */
const DOUBLE_CLICK_WINDOW_MS = 220;

/** Defensive fallback only — every non-`grow` panel always has a stored height (seeded from the
 *  registry's `defaultHeight` on first load), so this should never actually be read. */
const FALLBACK_HEIGHT = 240;

export function CollapsiblePanel({
  id, title, children, collapsed, onToggleCollapsed, maximized, onToggleMaximized, grow, height,
  onClose, onResetHeight, menuItems, draggedOver, onDragStart, onDragEnd, onDragOverHeader, onDropOnHeader,
}: CollapsiblePanelProps) {
  const clickTimer = useRef<number | null>(null);
  const isGrowExpanded = !!grow && !collapsed;

  function handleChevronClick() {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
      return; // second click of a double-click — the dblclick handler owns this gesture instead.
    }
    clickTimer.current = window.setTimeout(() => {
      onToggleCollapsed();
      clickTimer.current = null;
    }, DOUBLE_CLICK_WINDOW_MS);
  }

  function handleHeaderDoubleClick() {
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    onToggleMaximized();
  }

  function handleMenuClick() {
    const inputOptions: Record<string, string> = {};
    if (!grow) inputOptions.resetHeight = 'Reset to Default Height';
    inputOptions.close = 'Close Panel';
    menuItems?.forEach((item, i) => { inputOptions[`extra-${i}`] = item.label; });
    swal({
      title,
      input: 'select',
      inputOptions,
      inputPlaceholder: 'Choose an action',
      showCancelButton: true,
      confirmButtonText: 'Go',
    }).then((r) => {
      if (!r.isConfirmed || typeof r.value !== 'string') return;
      if (r.value === 'close') onClose();
      else if (r.value === 'resetHeight') onResetHeight();
      else if (r.value.startsWith('extra-')) menuItems?.[Number(r.value.slice('extra-'.length))]?.onSelect();
    });
  }

  const header = (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', id); onDragStart(); }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onDragOverHeader(e.clientY < rect.top + rect.height / 2);
      }}
      onDrop={(e) => { e.preventDefault(); onDropOnHeader(); }}
      onDoubleClick={handleHeaderDoubleClick}
      className={cn(
        'studio-interactive flex items-center gap-1.5 px-2 h-8 max-lg:h-11 shrink-0 border-b border-hairline/70 select-none',
        draggedOver === 'above' && 'border-t-2 !border-t-accent',
        draggedOver === 'below' && 'border-b-2 !border-b-accent'
      )}
    >
      <GripVertical size={12} className="text-ink-faint/50 shrink-0 cursor-grab" />
      <button
        type="button"
        aria-label={collapsed ? `Expand ${title} panel` : `Collapse ${title} panel`}
        onClick={handleChevronClick}
        className="studio-interactive flex items-center gap-1.5 flex-1 min-w-0 text-left"
      >
        {collapsed
          ? <ChevronRight size={12} className="text-ink-faint shrink-0" />
          : <ChevronDown size={12} className="text-ink-faint shrink-0" />}
        <span className="flex-1 text-micro font-display font-semibold text-ink-faint uppercase tracking-wider truncate">
          {title}
        </span>
      </button>
      <IconButton
        size="sm"
        aria-label={`${title} panel menu`}
        onClick={(e) => { e.stopPropagation(); handleMenuClick(); }}
        className="!bg-transparent max-lg:!w-11 max-lg:!h-11"
      >
        <MoreHorizontal size={13} />
      </IconButton>
    </div>
  );

  if (isGrowExpanded) {
    // A bare `flex-1 min-h-0` inside the outer stack's own `overflow-y-auto` would let this shrink
    // toward zero before the outer container starts scrolling — tall panels above it (TypeR's full
    // script/style list, expanded by default) could squeeze the layer list down to almost nothing
    // rather than the column just scrolling past them. A real minimum height keeps it usable no
    // matter what else is expanded above it; the outer stack scrolls past that floor instead.
    return (
      <div className="flex-1 min-h-[220px] flex flex-col border-b border-hairline">
        {header}
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col border-b border-hairline', maximized ? 'flex-1 min-h-0' : 'shrink-0')}>
      {header}
      {maximized ? (
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      ) : (
        <div
          style={{ maxHeight: collapsed ? 0 : (height ?? FALLBACK_HEIGHT), transition: 'max-height 200ms ease' }}
          className="overflow-y-auto"
        >
          {children}
        </div>
      )}
    </div>
  );
}
