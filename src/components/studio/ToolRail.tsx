import { IconButton } from '../ui';
import { STUDIO_TOOLS } from './tools';

interface ToolRailProps {
  activeTool: string;
  onToolChange: (id: string) => void;
  orientation?: 'vertical' | 'horizontal';
}

export function ToolRail({ activeTool, onToolChange, orientation = 'vertical' }: ToolRailProps) {
  const isVertical = orientation === 'vertical';

  return (
    <div
      className={
        isVertical
          ? 'liquid-glass-nav flex flex-col items-center gap-1 py-2.5 px-1.5 w-12 shrink-0 border-r border-hairline overflow-y-auto'
          : 'liquid-glass-bar flex items-center gap-1 px-2.5 h-12 shrink-0 border-t border-hairline overflow-x-auto'
      }
    >
      {STUDIO_TOOLS.map((tool) => {
        const Icon = tool.icon;
        const active = activeTool === tool.id;
        return (
          <div key={tool.id} className={isVertical ? 'contents' : 'contents'}>
            {tool.groupStart && (
              <div className={isVertical ? 'w-6 h-px bg-hairline my-1 shrink-0' : 'h-6 w-px bg-hairline mx-1 shrink-0'} />
            )}
            <IconButton
              size="sm"
              active={active}
              disabled={!tool.enabled}
              aria-label={tool.enabled ? tool.label : `${tool.label} (coming soon)`}
              title={tool.enabled ? tool.label : `${tool.label} — coming soon`}
              onClick={() => onToolChange(tool.id)}
              className="!bg-transparent shrink-0"
            >
              <Icon size={16} />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}
