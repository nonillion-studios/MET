import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { IconButton } from '../ui';
import { StudioPanel } from './StudioPanel';
import { useColor } from './color/ColorContext';

const DEFAULT_SWATCHES = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
  '#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47',
  '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130',
];

interface SwatchesPanelProps {
  hideTitle?: boolean;
}

export function SwatchesPanel({ hideTitle }: SwatchesPanelProps) {
  const {
    foreground, setForeground, setBackground,
    palettes, activePaletteId, setActivePaletteId, createPalette, deletePalette, addSwatch, removeSwatch,
  } = useColor();

  const [newPaletteOpen, setNewPaletteOpen] = useState(false);
  const [newPaletteName, setNewPaletteName] = useState('');
  const [confirmDeletePalette, setConfirmDeletePalette] = useState(false);
  const [showDefault, setShowDefault] = useState(true);

  const activePalette = palettes.find(p => p.id === activePaletteId) ?? null;

  function commitNewPalette() {
    setNewPaletteOpen(false);
    const name = newPaletteName.trim();
    if (name) createPalette(name);
  }

  function commitDeletePalette() {
    setConfirmDeletePalette(false);
    if (activePalette) deletePalette(activePalette.id);
  }

  return (
    <StudioPanel
      title="Swatches"
      hideTitle={hideTitle}
      actions={
        <div className="flex items-center gap-0.5">
          <IconButton size="sm" aria-label="Add foreground to palette" title="Add foreground color to palette"
            onClick={() => activePaletteId && addSwatch(activePaletteId, foreground)} disabled={!activePaletteId}
            className="!bg-transparent">
            <Plus size={13} />
          </IconButton>
        </div>
      }
    >
      {/* Default swatches grid */}
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => setShowDefault(v => !v)}
          className="text-micro text-ink-faint hover:text-ink text-left">
          {showDefault ? '▾' : '▸'} Default Colors
        </button>
        {showDefault && (
          <div className="grid gap-px" style={{ gridTemplateColumns: 'repeat(10, 1fr)' }}>
            {DEFAULT_SWATCHES.map((c, i) => (
              <button
                key={`${c}-${i}`}
                aria-label={`Swatch ${c}`}
                title={`${c} — Click: foreground, Right-click: background`}
                onClick={() => setForeground(c)}
                onContextMenu={(e) => { e.preventDefault(); setBackground(c); }}
                className="aspect-square rounded-sm border border-hairline/50 hover:border-accent/60 transition-colors"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Custom palettes */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-hairline/60">
        <div className="flex items-center justify-between gap-2">
          <select
            value={activePaletteId ?? ''}
            onChange={(e) => setActivePaletteId(e.target.value || null)}
            className="flex-1 min-w-0 bg-ink/5 border border-hairline rounded-control px-1.5 py-1 text-ink text-micro"
          >
            <option value="" disabled>{palettes.length === 0 ? 'No palettes' : 'Select palette'}</option>
            {palettes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <IconButton size="sm" aria-label="New palette" title="New palette"
            onClick={() => { setNewPaletteName(''); setNewPaletteOpen(true); }} className="!bg-transparent !w-6 !h-6">
            <Plus size={13} />
          </IconButton>
          {activePalette && (
            <IconButton size="sm" aria-label="Delete palette" title="Delete palette"
              onClick={() => setConfirmDeletePalette(true)} className="!bg-transparent !w-6 !h-6 hover:!text-danger">
              <Trash2 size={12} />
            </IconButton>
          )}
        </div>

        {activePalette && (
          <div className="flex flex-wrap gap-1">
            {activePalette.colors.map(c => (
              <button
                key={c}
                aria-label={`Palette swatch ${c}`}
                title={`${c} — Click: foreground, Right-click: background, Ctrl+Right-click: remove`}
                onClick={() => setForeground(c)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (e.ctrlKey || e.metaKey) removeSwatch(activePalette.id, c);
                  else setBackground(c);
                }}
                className="w-5 h-5 rounded-sm border border-hairline/50 hover:border-accent/60"
                style={{ backgroundColor: c }}
              />
            ))}
            <button
              aria-label="Add current foreground to palette"
              title="Add current foreground color"
              onClick={() => addSwatch(activePalette.id, foreground)}
              className="w-5 h-5 rounded-sm border border-dashed border-hairline/60 hover:border-accent/60 flex items-center justify-center text-ink-faint"
            >
              <Plus size={10} />
            </button>
          </div>
        )}
        {!activePalette && palettes.length === 0 && (
          <p className="text-micro text-ink-faint">Create a palette to save custom swatches.</p>
        )}
      </div>

      {newPaletteOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30" onClick={() => setNewPaletteOpen(false)}>
          <div className="bg-surface border border-hairline rounded-xl p-4 shadow-xl min-w-[240px]" onClick={(e) => e.stopPropagation()}>
            <div className="text-small font-semibold text-ink mb-2">New Palette</div>
            <input type="text" placeholder="Palette name" value={newPaletteName} onChange={(e) => setNewPaletteName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitNewPalette(); if (e.key === 'Escape') setNewPaletteOpen(false); }}
              className="w-full bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-small outline-none focus:border-accent" autoFocus />
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" onClick={() => setNewPaletteOpen(false)} className="px-3 py-1 text-small text-ink-faint hover:text-ink">Cancel</button>
              <button type="button" onClick={commitNewPalette} className="px-3 py-1 text-small bg-accent text-white rounded-control">Create</button>
            </div>
          </div>
        </div>
      )}
      {confirmDeletePalette && activePalette && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30" onClick={() => setConfirmDeletePalette(false)}>
          <div className="bg-surface border border-hairline rounded-xl p-4 shadow-xl min-w-[240px]" onClick={(e) => e.stopPropagation()}>
            <div className="text-small font-semibold text-ink mb-3">Delete &ldquo;{activePalette.name}&rdquo;?</div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDeletePalette(false)} className="px-3 py-1 text-small text-ink-faint hover:text-ink">Cancel</button>
              <button type="button" onClick={commitDeletePalette} className="px-3 py-1 text-small bg-red-500 text-white rounded-control hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}
    </StudioPanel>
  );
}
