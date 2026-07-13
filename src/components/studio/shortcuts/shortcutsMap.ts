import { STUDIO_TOOL_GROUPS } from '../toolGroups';

/** key (lowercase) -> tool id, built from each tool's `shortcut` field so hotkeys stay in sync with the toolbar. */
export function buildToolShortcutMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const group of STUDIO_TOOL_GROUPS) {
    for (const tool of group.tools) {
      if (tool.shortcut && tool.enabled) map[tool.shortcut] = tool.id;
    }
  }
  return map;
}

export const FIXED_SHORTCUTS_HELP: { keys: string; description: string }[] = [
  { keys: '[ / ]', description: 'Decrease / increase brush size' },
  { keys: 'X', description: 'Swap foreground / background color' },
  { keys: 'D', description: 'Reset to default colors (black / white)' },
  { keys: 'Ctrl/Cmd+Z', description: 'Undo' },
  { keys: 'Ctrl/Cmd+Shift+Z', description: 'Redo' },
  { keys: 'Ctrl/Cmd+=', description: 'Zoom in' },
  { keys: 'Ctrl/Cmd+-', description: 'Zoom out' },
  { keys: 'Ctrl/Cmd+0', description: 'Fit to screen' },
];
