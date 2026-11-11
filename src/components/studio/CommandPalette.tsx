import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { STUDIO_TOOL_GROUPS } from './toolGroups';
import type { MenuDef, MenuItemDef } from './menu/menuDefinitions';

interface CommandEntry {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
}

interface CommandPaletteProps {
  menus: MenuDef[];
  onSelectTool: (toolId: string) => void;
  onClose: () => void;
}

function flattenMenu(items: MenuItemDef[], prefix: string): CommandEntry[] {
  const out: CommandEntry[] = [];
  for (const item of items) {
    if (item.separator || !item.label) continue;
    const label = prefix ? `${prefix} > ${item.label}` : item.label;
    if (item.submenu) {
      out.push(...flattenMenu(item.submenu, label));
    } else if (item.action) {
      out.push({
        id: `menu-${item.id}`,
        label,
        category: 'Menu',
        shortcut: item.shortcut,
        action: item.action,
        disabled: item.disabled,
      });
    }
  }
  return out;
}

function matchScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 3;
  if (t.startsWith(q)) return 2;
  if (t.includes(q)) return 1;
  const words = q.split(/\s+/);
  if (words.length > 1 && words.every(w => t.includes(w))) return 0.5;
  return 0;
}

export function CommandPalette({ menus, onSelectTool, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const allEntries = useMemo(() => {
    const entries: CommandEntry[] = [];
    for (const menu of menus) {
      entries.push(...flattenMenu(menu.items, menu.label));
    }
    for (const group of STUDIO_TOOL_GROUPS) {
      for (const tool of group.tools) {
        if (!tool.enabled) continue;
        entries.push({
          id: `tool-${tool.id}`,
          label: tool.label,
          category: 'Tool',
          shortcut: tool.shortcut?.toUpperCase(),
          action: () => onSelectTool(tool.id),
        });
      }
    }
    return entries;
  }, [menus, onSelectTool]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allEntries.filter(e => !e.disabled);
    return allEntries
      .map(e => ({ entry: e, score: matchScore(query, e.label) }))
      .filter(r => r.score > 0 && !r.entry.disabled)
      .sort((a, b) => b.score - a.score)
      .map(r => r.entry);
  }, [query, allEntries]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const run = useCallback((entry: CommandEntry) => {
    onClose();
    entry.action();
  }, [onClose]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && filtered[selectedIndex]) { e.preventDefault(); run(filtered[selectedIndex]); }
  }, [filtered, selectedIndex, run]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] bg-black/40" onClick={onClose}>
      <div className="bg-surface border border-hairline rounded-xl shadow-2xl w-[480px] max-h-[60vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-hairline">
          <Search size={16} className="text-ink-faint shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search commands, tools, menus..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="flex-1 text-small bg-transparent text-ink placeholder:text-ink-faint/50 focus:outline-none"
          />
          <kbd className="text-[10px] text-ink-faint/60 bg-ink/5 px-1.5 py-0.5 rounded">Esc</kbd>
        </div>
        <div ref={listRef} className="overflow-y-auto flex-1 py-1">
          {filtered.length === 0 && (
            <div className="text-micro text-ink-faint text-center py-6">No matching commands</div>
          )}
          {filtered.slice(0, 50).map((entry, i) => (
            <button
              key={entry.id}
              type="button"
              className={`w-full text-left flex items-center justify-between px-3 py-1.5 text-small ${i === selectedIndex ? 'bg-accent/10 text-accent' : 'text-ink hover:bg-ink/5'}`}
              onClick={() => run(entry)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] text-ink-faint/60 w-8 shrink-0">{entry.category}</span>
                <span className="truncate">{entry.label}</span>
              </span>
              {entry.shortcut && <kbd className="text-[10px] text-ink-faint/60 bg-ink/5 px-1.5 py-0.5 rounded ml-2 shrink-0">{entry.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
