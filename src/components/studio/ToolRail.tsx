import { STUDIO_TOOL_GROUPS } from './toolGroups';
import { ToolGroupButton } from './ToolGroupButton';

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
          ? 'liquid-glass-nav flex flex-col items-center gap-1 py-2.5 px-1.5 w-12 shrink-0 border-r border-hairline overflow-y-auto overflow-x-visible'
          : 'liquid-glass-bar flex items-center gap-1 px-2.5 h-12 shrink-0 border-t border-hairline overflow-x-auto'
      }
    >
      {STUDIO_TOOL_GROUPS.map((group) => (
        <div key={group.id} className="contents">
          {group.groupStart && (
            <div className={isVertical ? 'w-6 h-px bg-hairline my-1 shrink-0' : 'h-6 w-px bg-hairline mx-1 shrink-0'} />
          )}
          <ToolGroupButton group={group} activeTool={activeTool} onToolChange={onToolChange} orientation={orientation} />
        </div>
      ))}
    </div>
  );
}
