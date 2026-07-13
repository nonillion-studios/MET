import { useRef, useState } from 'react';
import { IconButton } from '../ui';
import { ToolFlyout } from './ToolFlyout';
import type { StudioToolGroup } from './toolGroups';

interface ToolGroupButtonProps {
  group: StudioToolGroup;
  activeTool: string;
  onToolChange: (id: string) => void;
  orientation: 'vertical' | 'horizontal';
}

const HOLD_MS = 350;

export function ToolGroupButton({ group, activeTool, onToolChange, orientation }: ToolGroupButtonProps) {
  const [remembered, setRemembered] = useState(group.tools[0].id);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeInGroup = group.tools.find(t => t.id === activeTool);
  const shown = activeInGroup ?? group.tools.find(t => t.id === remembered) ?? group.tools[0];
  const Icon = shown.icon;
  const hasSiblings = group.tools.length > 1;

  function pick(id: string) {
    setRemembered(id);
    onToolChange(id);
  }

  function startHold() {
    if (!hasSiblings) return;
    holdTimer.current = setTimeout(() => setFlyoutOpen(true), HOLD_MS);
  }
  function cancelHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }

  return (
    <div className="relative contents">
      <div className="relative">
        <IconButton
          size="sm"
          active={!!activeInGroup}
          disabled={!shown.enabled}
          aria-label={shown.enabled ? shown.label : `${shown.label} (coming soon)`}
          title={shown.enabled ? `${shown.label}${shown.shortcut ? ` (${shown.shortcut.toUpperCase()})` : ''}` : `${shown.label} — coming soon`}
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onClick={() => pick(shown.id)}
          onContextMenu={(e) => { e.preventDefault(); if (hasSiblings) setFlyoutOpen(true); }}
          className="!bg-transparent shrink-0"
        >
          <Icon size={16} />
        </IconButton>
        {hasSiblings && (
          <span
            onClick={(e) => { e.stopPropagation(); setFlyoutOpen(v => !v); }}
            className="absolute bottom-0 right-0 w-0 h-0 border-solid cursor-pointer"
            style={{ borderWidth: '0 0 5px 5px', borderColor: 'transparent transparent var(--color-ink-faint) transparent' }}
          />
        )}
        {flyoutOpen && (
          <ToolFlyout
            tools={group.tools}
            activeTool={activeTool}
            orientation={orientation}
            onPick={pick}
            onClose={() => setFlyoutOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
