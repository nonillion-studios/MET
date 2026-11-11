import { STUDIO_TOOL_GROUPS } from './toolGroups';
import { ToolGroupButton } from './ToolGroupButton';
import { useColor } from './color/ColorContext';

interface ToolRailProps {
  activeTool: string;
  onToolChange: (id: string) => void;
  orientation?: 'vertical' | 'horizontal';
}

export function ToolRail({ activeTool, onToolChange, orientation = 'vertical' }: ToolRailProps) {
  const isVertical = orientation === 'vertical';
  const { foreground, background, swap, reset } = useColor();

  return (
    <div
      className={
        isVertical
          ? 'liquid-glass-nav flex flex-col items-center gap-1 py-2.5 px-1.5 w-12 shrink-0 border-r border-hairline overflow-y-auto'
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
      {isVertical && (
        <>
          <div className="w-6 h-px bg-hairline my-1 shrink-0" />
          <div className="relative w-9 h-9 shrink-0" title="Foreground / Background (X to swap, D to reset)">
            <button
              type="button"
              className="absolute bottom-0 right-0 w-6 h-6 rounded-sm border-2 border-white/60 shadow-sm"
              style={{ backgroundColor: background }}
              onClick={swap}
              aria-label="Background color (click to swap)"
            />
            <button
              type="button"
              className="absolute top-0 left-0 w-6 h-6 rounded-sm border-2 border-white/60 shadow-sm z-10"
              style={{ backgroundColor: foreground }}
              onClick={swap}
              aria-label="Foreground color (click to swap)"
            />
            <button
              type="button"
              className="absolute bottom-0 left-0 w-3 h-3 flex items-center justify-center text-[8px] text-ink-faint hover:text-ink z-20"
              onClick={reset}
              aria-label="Reset to default colors"
              title="Reset (D)"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="0.5" y="4" width="5" height="5" fill="currentColor" />
                <rect x="4" y="0.5" width="5" height="5" fill="white" stroke="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              className="absolute top-0 right-0 w-3 h-3 flex items-center justify-center text-[8px] text-ink-faint hover:text-ink z-20"
              onClick={swap}
              aria-label="Swap colors"
              title="Swap (X)"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M2 3h6M6 1l2 2-2 2M8 7H2M4 9l-2-2 2-2" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
