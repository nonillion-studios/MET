import { useEffect } from 'react';
import { X } from 'lucide-react';
import { STUDIO_TOOL_GROUPS } from './toolGroups';
import { FIXED_SHORTCUTS_HELP } from './shortcuts/shortcutsMap';

interface KeyboardShortcutsOverlayProps {
  onClose: () => void;
}

export function KeyboardShortcutsOverlay({ onClose }: KeyboardShortcutsOverlayProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); e.stopPropagation(); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const toolShortcuts: { keys: string; description: string }[] = [];
  for (const group of STUDIO_TOOL_GROUPS) {
    for (const tool of group.tools) {
      if (tool.shortcut && tool.enabled) {
        toolShortcuts.push({ keys: tool.shortcut.toUpperCase(), description: tool.label });
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="relative w-full max-w-xl max-h-[80vh] overflow-y-auto rounded-xl border border-hairline bg-surface shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-ink">Keyboard Shortcuts</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-control hover:bg-ink/10 text-ink-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-0">
          <div>
            <h3 className="text-small font-semibold text-ink mb-2 uppercase tracking-wide">Tools</h3>
            {toolShortcuts.map(({ keys, description }) => (
              <div key={keys + description} className="flex items-center justify-between py-1 border-b border-hairline/40">
                <span className="text-small text-ink">{description}</span>
                <kbd className="text-micro px-1.5 py-0.5 rounded border border-hairline bg-ink/5 text-ink-faint font-mono">{keys}</kbd>
              </div>
            ))}
          </div>

          <div>
            <h3 className="text-small font-semibold text-ink mb-2 uppercase tracking-wide">General</h3>
            {FIXED_SHORTCUTS_HELP.map(({ keys, description }) => (
              <div key={keys} className="flex items-center justify-between py-1 border-b border-hairline/40 gap-4">
                <span className="text-small text-ink">{description}</span>
                <kbd className="text-micro px-1.5 py-0.5 rounded border border-hairline bg-ink/5 text-ink-faint font-mono whitespace-nowrap shrink-0">{keys}</kbd>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
