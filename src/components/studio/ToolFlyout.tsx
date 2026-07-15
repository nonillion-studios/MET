import { useEffect, useRef } from 'react';
import { IconButton } from '../ui';
import { cn } from '../ui/cn';
import type { StudioToolDef } from './toolGroups';

interface ToolFlyoutProps {
  tools: StudioToolDef[];
  activeTool: string;
  orientation: 'vertical' | 'horizontal';
  onPick: (id: string) => void;
  onClose: () => void;
}

export function ToolFlyout({ tools, activeTool, orientation, onPick, onClose }: ToolFlyoutProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  const isVertical = orientation === 'vertical';

  return (
    <div
      ref={ref}
      className={cn(
        'absolute z-50 liquid-glass-heavy rounded-panel border border-hairline p-1 flex gap-0.5',
        isVertical ? 'left-full top-0 ml-1.5 flex-col' : 'bottom-full left-0 mb-1.5 flex-row'
      )}
    >
      {tools.map(tool => {
        const Icon = tool.icon;
        return (
          <IconButton
            key={tool.id}
            size="sm"
            active={activeTool === tool.id}
            disabled={!tool.enabled}
            aria-label={tool.enabled ? tool.label : `${tool.label} (coming soon)`}
            title={tool.enabled ? `${tool.label}${tool.shortcut ? ` (${tool.shortcut.toUpperCase()})` : ''}` : `${tool.label} — coming soon`}
            onClick={() => { onPick(tool.id); onClose(); }}
            className="!bg-transparent shrink-0"
          >
            <Icon size={16} />
          </IconButton>
        );
      })}
    </div>
  );
}
