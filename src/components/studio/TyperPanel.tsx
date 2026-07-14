import { useMemo, useRef, useState } from 'react';
import { Target, RotateCcw, Plus, Trash2, Copy, Download, Upload } from 'lucide-react';
import { Textarea, IconButton } from '../ui';
import { cn } from '../ui/cn';
import { swal, swalToast } from '../../lib/swalTheme';
import { parseTyperScript, createTyperStyle, type TyperStyle } from './studioTypes';

interface TyperPanelProps {
  script: string;
  onScriptChange: (script: string) => void;
  styles: TyperStyle[];
  onStylesChange: (styles: TyperStyle[]) => void;
  index: number;
  onIndexChange: (index: number) => void;
  armed: boolean;
  onArmedChange: (armed: boolean) => void;
}

export function TyperPanel({
  script, onScriptChange, styles, onStylesChange, index, onIndexChange, armed, onArmedChange,
}: TyperPanelProps) {
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null);
  const [sizeStep, setSizeStep] = useState(2);
  const importInputRef = useRef<HTMLInputElement>(null);
  const lines = useMemo(() => parseTyperScript(script, styles), [script, styles]);
  const current = lines[index] ?? null;
  const done = lines.length > 0 && index >= lines.length;

  const folders = useMemo(() => {
    const order: string[] = [];
    for (const s of styles) {
      const f = s.folder || 'General';
      if (!order.includes(f)) order.push(f);
    }
    return order;
  }, [styles]);

  function updateStyle(id: string, patch: Partial<TyperStyle>) {
    onStylesChange(styles.map(s => s.id === id ? { ...s, ...patch } : s));
  }

  function addStyle() {
    const style = createTyperStyle(`Style ${styles.length + 1}`);
    onStylesChange([...styles, style]);
    setEditingStyleId(style.id);
  }

  function duplicateStyle(id: string) {
    const source = styles.find(s => s.id === id);
    if (!source) return;
    const copy = { ...source, id: `${source.id}-copy-${Date.now()}`, name: `${source.name} copy` };
    onStylesChange([...styles, copy]);
  }

  function deleteStyle(id: string) {
    if (styles.length <= 1) return;
    onStylesChange(styles.filter(s => s.id !== id));
  }

  function exportTyperJson() {
    const payload = { script, styles };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'TypeR_Export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function importTyperJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.styles)) throw new Error('Missing styles array');
      onStylesChange(parsed.styles);
      if (typeof parsed.script === 'string') onScriptChange(parsed.script);
      swalToast({ icon: 'success', title: 'TypeR styles imported' });
    } catch (err) {
      swal({ icon: 'error', title: 'Import Failed', text: err instanceof Error ? err.message : 'Invalid TypeR JSON file.' });
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-hairline">
        <span className="text-xs font-display font-semibold text-ink-faint uppercase tracking-wide">TypeR</span>
        <div className="flex items-center gap-0.5">
          <IconButton size="sm" aria-label="Import TypeR JSON" title="Import TypeR JSON" onClick={() => importInputRef.current?.click()} className="!bg-transparent">
            <Upload size={13} />
          </IconButton>
          <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={importTyperJson} />
          <IconButton size="sm" aria-label="Export TypeR JSON" title="Export TypeR JSON" onClick={exportTyperJson} className="!bg-transparent">
            <Download size={13} />
          </IconButton>
          <IconButton
            size="sm"
            aria-label="Reset progress"
            title="Reset progress"
            onClick={() => { onIndexChange(0); onArmedChange(false); }}
            className="!bg-transparent"
          >
            <RotateCcw size={13} />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        <Textarea
          value={script}
          onChange={(e) => { onScriptChange(e.target.value); onIndexChange(0); }}
          placeholder={'Paste a script, one line per bubble.\nPrefix lines to pick a style, e.g.\n!! for SFX, ~ for Thought.\n## note (ignored)\n// continuation of the previous line\nPage 3 (auto-switches when reached)'}
          rows={6}
          className="!text-xs !font-mono"
        />

        <div className="flex items-center justify-between text-[11px] text-ink-faint">
          <span>{lines.length > 0 ? `Line ${Math.min(index + 1, lines.length)} / ${lines.length}` : 'No lines yet'}</span>
          <div className="flex items-center gap-1.5">
            {current?.pageHint && <span className="px-1.5 py-0.5 rounded bg-ink/10 text-ink-faint">Page {current.pageHint}</span>}
            {current && <span className="px-1.5 py-0.5 rounded bg-accent-soft text-accent">{current.style.name}</span>}
          </div>
        </div>

        {current && (
          <div className="rounded-lg border border-hairline bg-ink/[0.03] px-2.5 py-2 text-xs text-ink truncate">
            {current.content}
          </div>
        )}
        {done && <div className="text-[11px] text-ink-faint italic">All lines placed.</div>}

        <button
          type="button"
          disabled={lines.length === 0 || done}
          onClick={() => onArmedChange(!armed)}
          className={cn(
            'flex items-center justify-center gap-2 h-9 rounded-lg text-xs font-medium border transition-colors',
            'disabled:opacity-40 disabled:pointer-events-none',
            armed ? 'bg-accent text-white border-accent' : 'bg-ink/5 border-hairline text-ink hover:bg-ink/10'
          )}
        >
          <Target size={14} />
          {armed ? 'Armed — click the canvas to place' : 'Arm placement'}
        </button>

        <div className="flex flex-col gap-2 pt-2 border-t border-hairline/60">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ink-faint">Styles</span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[10px] text-ink-faint" title="Size step used by the +/- quick editor">
                <span>Step</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={sizeStep}
                  onChange={(e) => setSizeStep(Math.max(1, Number(e.target.value) || 1))}
                  className="w-9 bg-ink/5 border border-hairline rounded px-1 py-0.5 text-ink text-[10px]"
                />
              </label>
              <IconButton size="sm" aria-label="Add style" title="Add style" onClick={addStyle} className="!bg-transparent !w-6 !h-6">
                <Plus size={13} />
              </IconButton>
            </div>
          </div>

          {folders.map(folder => (
            <details key={folder} open className="group">
              <summary className="text-[10px] text-ink-faint uppercase tracking-wide cursor-pointer select-none py-1">{folder}</summary>
              <div className="flex flex-col gap-2 pl-0.5">
                {styles.filter(s => (s.folder || 'General') === folder).map(style => {
                  const expanded = editingStyleId === style.id;
                  return (
                    <div key={style.id} className="rounded-lg border border-hairline bg-ink/[0.03]">
                      <div className="w-full flex items-center gap-1 px-2.5 h-9">
                        <button
                          type="button"
                          onClick={() => setEditingStyleId(expanded ? null : style.id)}
                          className="flex-1 flex items-center gap-2 text-left min-w-0"
                        >
                          <span className="text-xs font-medium text-ink flex-1 truncate">{style.name}</span>
                          {style.prefix && <span className="text-[10px] font-mono text-ink-faint shrink-0">{style.prefix}</span>}
                        </button>
                        {/* Quick text-size editor — no need to expand the full style card just to bump a size. */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          <IconButton size="sm" aria-label="Decrease size" onClick={() => updateStyle(style.id, { fontSize: Math.max(6, style.fontSize - sizeStep) })} className="!bg-transparent !w-6 !h-6">
                            <span className="text-xs">−</span>
                          </IconButton>
                          <span className="text-[10px] font-mono text-ink-faint w-6 text-center">{style.fontSize}</span>
                          <IconButton size="sm" aria-label="Increase size" onClick={() => updateStyle(style.id, { fontSize: Math.min(200, style.fontSize + sizeStep) })} className="!bg-transparent !w-6 !h-6">
                            <span className="text-xs">+</span>
                          </IconButton>
                        </div>
                        <IconButton size="sm" aria-label="Duplicate style" title="Duplicate style" onClick={() => duplicateStyle(style.id)} className="!bg-transparent !w-6 !h-6">
                          <Copy size={11} />
                        </IconButton>
                        <IconButton size="sm" aria-label="Delete style" title="Delete style" disabled={styles.length <= 1} onClick={() => deleteStyle(style.id)} className="!bg-transparent !w-6 !h-6 hover:!text-danger">
                          <Trash2 size={11} />
                        </IconButton>
                      </div>
                      {expanded && (
                        <div className="px-2.5 pb-2.5 flex flex-col gap-2 border-t border-hairline/60">
                          <div className="flex items-center gap-2 pt-2">
                            <label className="flex items-center gap-2 text-[11px] text-ink-faint flex-1">
                              <span className="w-10 shrink-0">Name</span>
                              <input
                                value={style.name}
                                onChange={(e) => updateStyle(style.id, { name: e.target.value })}
                                className="flex-1 bg-ink/5 border border-hairline rounded-md px-1.5 py-1 text-ink text-[11px]"
                              />
                            </label>
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-2 text-[11px] text-ink-faint flex-1">
                              <span className="w-14 shrink-0">Folder</span>
                              <input
                                value={style.folder ?? 'General'}
                                onChange={(e) => updateStyle(style.id, { folder: e.target.value || 'General' })}
                                className="flex-1 bg-ink/5 border border-hairline rounded-md px-1.5 py-1 text-ink text-[11px]"
                              />
                            </label>
                          </div>
                          <label className="flex items-center gap-2 text-[11px] text-ink-faint">
                            <span className="w-14 shrink-0">Prefix</span>
                            <input
                              value={style.prefix}
                              onChange={(e) => updateStyle(style.id, { prefix: e.target.value })}
                              className="flex-1 bg-ink/5 border border-hairline rounded-md px-1.5 py-1 text-ink text-[11px] font-mono"
                            />
                          </label>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-2 text-[11px] text-ink-faint flex-1">
                              <span className="shrink-0">Size</span>
                              <input
                                type="number"
                                min={6}
                                max={200}
                                value={style.fontSize}
                                onChange={(e) => updateStyle(style.id, { fontSize: Number(e.target.value) || style.fontSize })}
                                className="w-full bg-ink/5 border border-hairline rounded-md px-1.5 py-1 text-ink text-[11px]"
                              />
                            </label>
                            <input
                              type="color"
                              value={style.color}
                              onChange={(e) => updateStyle(style.id, { color: e.target.value })}
                              className="w-8 h-7 rounded-md border border-hairline bg-transparent"
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <IconButton size="sm" active={style.bold} aria-label="Bold" onClick={() => updateStyle(style.id, { bold: !style.bold })} className="!bg-transparent !w-7 !h-7">
                              <span className="text-xs font-bold">B</span>
                            </IconButton>
                            <IconButton size="sm" active={style.italic} aria-label="Italic" onClick={() => updateStyle(style.id, { italic: !style.italic })} className="!bg-transparent !w-7 !h-7">
                              <span className="text-xs italic">I</span>
                            </IconButton>
                            <div className="w-px h-5 bg-hairline mx-1" />
                            <input
                              type="color"
                              title="Stroke color"
                              value={style.strokeColor}
                              onChange={(e) => updateStyle(style.id, { strokeColor: e.target.value })}
                              className="w-7 h-7 rounded-md border border-hairline bg-transparent"
                            />
                            <input
                              type="range"
                              min={0}
                              max={8}
                              step={0.5}
                              value={style.strokeWidth}
                              onChange={(e) => updateStyle(style.id, { strokeWidth: Number(e.target.value) })}
                              className="flex-1 accent-[var(--color-accent)]"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
