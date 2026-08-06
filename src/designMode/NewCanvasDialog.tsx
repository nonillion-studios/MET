import { useMemo, useState } from 'react';
import { Modal, Button, Input } from '../components/ui';
import { genId } from '../lib/id';
import { createLayer } from '../components/studio/studioTypes';
import type { DesignImage } from './designModeStore';

interface Preset {
  name: string;
  width: number;
  height: number;
}

const PRESETS: Preset[] = [
  { name: 'Web 1920×1080', width: 1920, height: 1080 },
  { name: 'Web 1280×720', width: 1280, height: 720 },
  { name: 'Instagram Post 1080×1080', width: 1080, height: 1080 },
  { name: 'Instagram Story 1080×1920', width: 1080, height: 1920 },
  { name: 'Twitter Header 1500×500', width: 1500, height: 500 },
  { name: 'Facebook Cover 820×312', width: 820, height: 312 },
  { name: 'A4 Portrait 2480×3508', width: 2480, height: 3508 },
  { name: 'A4 Landscape 3508×2480', width: 3508, height: 2480 },
  { name: 'Square 1000×1000', width: 1000, height: 1000 },
];

type Background = 'white' | 'black' | 'transparent';

const BACKGROUND_OPTIONS: { id: Background; label: string; swatch: string }[] = [
  { id: 'white', label: 'White', swatch: '#ffffff' },
  { id: 'black', label: 'Black', swatch: '#000000' },
  { id: 'transparent', label: 'Transparent', swatch: 'transparent' },
];

interface NewCanvasDialogProps {
  open: boolean;
  /** False only for the very first canvas (no images exist yet) — matches the spec: Cancel is
   *  hidden then, since there's nothing to fall back to. */
  dismissible: boolean;
  onCancel: () => void;
  onCreate: (image: DesignImage) => void;
}

export function NewCanvasDialog({ open, dismissible, onCancel, onCreate }: NewCanvasDialogProps) {
  const [name, setName] = useState('Untitled Design');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [resolution, setResolution] = useState(72);
  const [background, setBackground] = useState<Background>('white');

  const activePreset = useMemo(
    () => PRESETS.find(p => p.width === width && p.height === height)?.name ?? 'Custom',
    [width, height],
  );

  const applyPreset = (presetName: string) => {
    const preset = PRESETS.find(p => p.name === presetName);
    if (preset) { setWidth(preset.width); setHeight(preset.height); }
  };

  const handleCreate = () => {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const layers = background === 'transparent' ? [] : [(() => {
      const layer = createLayer('clean-patch', 'Background');
      layer.isBackground = true;
      layer.locked = true;
      return layer;
    })()];
    const image: DesignImage = {
      id: genId('design-img'),
      name: name.trim() || 'Untitled Design',
      width: w,
      height: h,
      layers,
      activeLayerId: layers[0]?.id ?? null,
      thumbnail: '',
      ...(background !== 'transparent' ? { pendingBackgroundFill: background } : {}),
    };
    onCreate(image);
    // Reset for next time this dialog opens.
    setName('Untitled Design');
    setWidth(1920);
    setHeight(1080);
    setResolution(72);
    setBackground('white');
  };

  return (
    <Modal open={open} onClose={onCancel} title="New Canvas" size="sm" dismissible={dismissible}>
      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-ink-muted mb-1 block">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled Design" />
        </div>

        <div>
          <label className="text-xs font-semibold text-ink-muted mb-1 block">Preset</label>
          <select
            value={activePreset}
            onChange={(e) => applyPreset(e.target.value)}
            className="w-full bg-ink/5 border border-ink/10 rounded-xl px-4 py-2.5 text-ink text-sm outline-none focus:border-accent focus:bg-surface"
          >
            <option value="Custom">Custom</option>
            {PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-ink-muted mb-1 block">Width (px)</label>
            <Input type="number" min={1} value={width} onChange={(e) => setWidth(Number(e.target.value) || 1)} />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-muted mb-1 block">Height (px)</label>
            <Input type="number" min={1} value={height} onChange={(e) => setHeight(Number(e.target.value) || 1)} />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-ink-muted mb-1 block">Resolution (ppi)</label>
          <Input type="number" min={1} value={resolution} onChange={(e) => setResolution(Number(e.target.value) || 1)} />
        </div>

        <div>
          <label className="text-xs font-semibold text-ink-muted mb-1 block">Background</label>
          <div className="flex gap-2">
            {BACKGROUND_OPTIONS.map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setBackground(opt.id)}
                aria-label={opt.label}
                aria-pressed={background === opt.id}
                className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-colors ${
                  background === opt.id ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-muted hover:bg-ink/5'
                }`}
              >
                <span
                  className="w-4 h-4 rounded-full border border-hairline shrink-0"
                  style={opt.id === 'transparent'
                    ? { backgroundImage: 'linear-gradient(45deg, #999 25%, transparent 25%), linear-gradient(-45deg, #999 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #999 75%), linear-gradient(-45deg, transparent 75%, #999 75%)', backgroundSize: '6px 6px', backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0' }
                    : { background: opt.swatch }}
                />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          {dismissible && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
          <Button variant="primary" onClick={handleCreate}>Create</Button>
        </div>
      </div>
    </Modal>
  );
}
