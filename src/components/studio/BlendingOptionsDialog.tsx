import { useEffect, useState } from 'react';
import { Modal, Button } from '../ui';
import { Slider, CheckboxRow, ColorRow, ChannelTabs } from './panelControls';
import { BlendIfSlider } from './BlendIfSlider';
import { swal } from '../../lib/swalTheme';
import { loadLayerStylePresets, saveLayerStylePresets, type LayerStylePreset } from '../../lib/layerStyleStore';
import {
  BLEND_MODES, createDefaultLayerEffects,
  type BlendMode, type LayerEffects, type LayerStyleKey, type StudioLayer,
} from './studioTypes';

interface BlendingOptionsDialogProps {
  open: boolean;
  layer: StudioLayer;
  onClose: () => void;
  /** Called on every field change while Preview is on (live canvas update, no history entry) and
   *  once more, unconditionally, on OK (the real committed, undoable change). */
  onUpdate: (patch: { blendMode?: BlendMode; opacity?: number; effects: LayerEffects }, commit: boolean) => void;
  /** Which left-nav entry to open directly on (the fx badge / a sub-row's own re-open). Defaults to
   *  General Blending. */
  initialSection?: StyleKey;
}

type StyleKey = 'blending' | LayerStyleKey;

const NAV_ITEMS: { key: StyleKey; label: string; styleField?: LayerStyleKey; indent?: boolean }[] = [
  { key: 'blending', label: 'Blending Options' },
  { key: 'dropShadow', label: 'Drop Shadow', styleField: 'dropShadow' },
  { key: 'innerShadow', label: 'Inner Shadow', styleField: 'innerShadow' },
  { key: 'outerGlow', label: 'Outer Glow', styleField: 'outerGlow' },
  { key: 'innerGlow', label: 'Inner Glow', styleField: 'innerGlow' },
  { key: 'bevelEmboss', label: 'Bevel & Emboss', styleField: 'bevelEmboss' },
  { key: 'satin', label: 'Satin', styleField: 'satin' },
  { key: 'colorOverlay', label: 'Color Overlay', styleField: 'colorOverlay' },
  { key: 'gradientOverlay', label: 'Gradient Overlay', styleField: 'gradientOverlay' },
  { key: 'patternOverlay', label: 'Pattern Overlay', styleField: 'patternOverlay' },
  { key: 'stroke', label: 'Stroke', styleField: 'stroke' },
];

function BlendModeSelect({ value, onChange }: { value: BlendMode; onChange: (v: BlendMode) => void }) {
  return (
    <label className="flex flex-col gap-1 text-micro text-ink-faint">
      <span>Blend Mode</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as BlendMode)}
        className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
      >
        {BLEND_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
    </label>
  );
}

/**
 * Photoshop's Layer Style / Blending Options dialog — a real two-pane (left-nav + right-panel)
 * modal, the first of its shape in this codebase (no prior two-pane dialog existed anywhere to
 * extend). Local draft state until OK; Preview live-updates the real layer while checked, Cancel
 * reverts to the snapshot taken on open (same `FilterDialog.tsx` pattern this app already uses for
 * "edit live, commit or revert on close").
 *
 * Every style except Pattern Overlay renders live on the Konva canvas as well as in flattened
 * PNG/JPG/WEBP and PSD export (see `StudioCanvas.tsx`'s `renderLeaf` and `liveLayerEffects.ts`,
 * which reuses the exact same halo math `exportImage.ts` uses for export, so the two can't drift).
 * Pattern Overlay stays a real no-op everywhere — there's no pattern-asset library in this app (see
 * `PatternOverlayStyleData`'s own doc comment).
 */
export function BlendingOptionsDialog({ open, layer, onClose, onUpdate, initialSection }: BlendingOptionsDialogProps) {
  const [section, setSection] = useState<StyleKey>(initialSection ?? 'blending');
  const [blendMode, setBlendMode] = useState<BlendMode>(layer.blendMode);
  const [opacity, setOpacity] = useState(Math.round(layer.opacity * 100));
  const [effects, setEffects] = useState<LayerEffects>(() => layer.effects ?? createDefaultLayerEffects());
  const [before, setBefore] = useState<{ blendMode: BlendMode; opacity: number; effects: LayerEffects } | null>(null);
  const [preview, setPreview] = useState(true);
  const [presets, setPresets] = useState<LayerStylePreset[]>([]);

  // Snapshot on open, reset draft to the layer's current real values — every render after that just
  // edits the local draft.
  useEffect(() => {
    if (!open) return;
    setSection(initialSection ?? 'blending');
    setBlendMode(layer.blendMode);
    setOpacity(Math.round(layer.opacity * 100));
    const initialEffects = layer.effects ?? createDefaultLayerEffects();
    setEffects(initialEffects);
    setBefore({ blendMode: layer.blendMode, opacity: layer.opacity, effects: initialEffects });
    void loadLayerStylePresets().then(setPresets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, layer.id]);

  useEffect(() => {
    if (!open || !preview) return;
    onUpdate({ blendMode, opacity: opacity / 100, effects }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preview, blendMode, opacity, effects]);

  if (!open) return null;

  function patchEffects<K extends keyof LayerEffects>(key: K, patch: Partial<LayerEffects[K]>) {
    setEffects((e) => ({ ...e, [key]: { ...e[key], ...patch } }));
  }

  function handleOk() {
    onUpdate({ blendMode, opacity: opacity / 100, effects }, true);
    onClose();
  }

  function handleCancel() {
    if (before) onUpdate(before, false);
    onClose();
  }

  function handleReset() {
    setBlendMode('normal');
    setOpacity(100);
    setEffects(createDefaultLayerEffects());
  }

  async function handleNewStyle() {
    const result = await swal({ title: 'New Style', input: 'text', inputPlaceholder: 'Style name', showCancelButton: true });
    const name = (result.value as string | undefined)?.trim();
    if (!name) return;
    const next = [...presets, { id: `style-${Date.now()}`, name, effects }];
    setPresets(next);
    await saveLayerStylePresets(next);
  }

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title={`Layer Style — ${layer.name}`}
      size="xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-micro text-ink-faint">
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
            Preview
          </label>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleReset}>Reset to Default</Button>
            <Button variant="secondary" onClick={handleNewStyle}>New Style…</Button>
            <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
            <Button onClick={handleOk}>OK</Button>
          </div>
        </div>
      }
    >
      <div className="flex gap-4 min-h-[420px]">
        <div className="w-48 shrink-0 flex flex-col gap-0.5 border-r border-hairline pr-3">
          {NAV_ITEMS.map((item) => (
            <div key={item.key} className="flex flex-col">
              <button
                type="button"
                onClick={() => setSection(item.key)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-control text-micro text-left ${
                  section === item.key ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-ink/5'
                }`}
              >
                {item.styleField && (
                  <input
                    type="checkbox"
                    checked={effects[item.styleField].enabled}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patchEffects(item.styleField!, { enabled: e.target.checked } as never)}
                  />
                )}
                {item.label}
              </button>
              {item.key === 'bevelEmboss' && (
                <div className="flex flex-col pl-6">
                  <button
                    type="button"
                    onClick={() => setSection('bevelEmboss')}
                    className={`flex items-center gap-2 px-2 py-1 rounded-control text-micro text-left text-ink-faint hover:bg-ink/5`}
                  >
                    <input type="checkbox" checked={effects.bevelEmboss.contourEnabled} onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patchEffects('bevelEmboss', { contourEnabled: e.target.checked })} />
                    Contour
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('bevelEmboss')}
                    className={`flex items-center gap-2 px-2 py-1 rounded-control text-micro text-left text-ink-faint hover:bg-ink/5`}
                  >
                    <input type="checkbox" checked={effects.bevelEmboss.textureEnabled} onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patchEffects('bevelEmboss', { textureEnabled: e.target.checked })} />
                    Texture
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto">
          {section === 'blending' && (
            <>
              <span className="text-micro font-semibold text-ink uppercase tracking-wide">General Blending</span>
              <BlendModeSelect value={blendMode} onChange={setBlendMode} />
              <Slider label="Opacity" min={0} max={100} value={opacity} onChange={setOpacity} />

              <span className="text-micro font-semibold text-ink uppercase tracking-wide pt-2">Advanced Blending</span>
              <Slider label="Fill Opacity" min={0} max={100} value={effects.advancedBlending.fillOpacity}
                onChange={(v) => patchEffects('advancedBlending', { fillOpacity: v })} />
              <div className="flex items-center gap-3 text-micro text-ink-faint">
                <span className="w-24 shrink-0">Channels</span>
                {(['r', 'g', 'b'] as const).map((c) => (
                  <label key={c} className="flex items-center gap-1">
                    <input type="checkbox" checked={effects.advancedBlending.channels[c]}
                      onChange={(e) => patchEffects('advancedBlending', { channels: { ...effects.advancedBlending.channels, [c]: e.target.checked } })} />
                    {c.toUpperCase()}
                  </label>
                ))}
              </div>
              <label className="flex flex-col gap-1 text-micro text-ink-faint">
                <span>Knockout</span>
                <select
                  value={effects.advancedBlending.knockout}
                  onChange={(e) => patchEffects('advancedBlending', { knockout: e.target.value as LayerEffects['advancedBlending']['knockout'] })}
                  className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
                >
                  <option value="none">None</option>
                  <option value="shallow">Shallow</option>
                  <option value="deep">Deep</option>
                </select>
              </label>
              <CheckboxRow label="Blend Interior Effects as Group" checked={effects.advancedBlending.blendInteriorEffectsAsGroup}
                onChange={(v) => patchEffects('advancedBlending', { blendInteriorEffectsAsGroup: v })} />
              <CheckboxRow label="Blend Clipped Layers as Group" checked={effects.advancedBlending.blendClippedLayersAsGroup}
                onChange={(v) => patchEffects('advancedBlending', { blendClippedLayersAsGroup: v })} />
              <CheckboxRow label="Transparency Shapes Layer" checked={effects.advancedBlending.transparencyShapesLayer}
                onChange={(v) => patchEffects('advancedBlending', { transparencyShapesLayer: v })} />
              <CheckboxRow label="Layer Mask Hides Effects" checked={effects.advancedBlending.layerMaskHidesEffects}
                onChange={(v) => patchEffects('advancedBlending', { layerMaskHidesEffects: v })} />
              <CheckboxRow label="Vector Mask Hides Effects" checked={effects.advancedBlending.vectorMaskHidesEffects}
                onChange={(v) => patchEffects('advancedBlending', { vectorMaskHidesEffects: v })} />

              <span className="text-micro font-semibold text-ink uppercase tracking-wide pt-2">Blend If</span>
              <p className="text-micro text-ink-faint/70">
                Gray Level. "This Layer" and "Underlying Layer" gate compositing by luminance — real in
                flattened export; "Underlying Layer" isn't live-previewed (see the Preview note below).
              </p>
              <ChannelTabs
                options={[{ id: 'gray', label: 'Gray' }, { id: 'r', label: 'Red' }, { id: 'g', label: 'Green' }, { id: 'b', label: 'Blue' }]}
                value={effects.blendIf.channel}
                onChange={(v) => patchEffects('blendIf', { channel: v })}
              />
              {(['thisLayer', 'underlying'] as const).map((side) => (
                <div key={side} className="flex flex-col gap-1.5">
                  <span className="text-micro text-ink-faint capitalize">{side === 'thisLayer' ? 'This Layer' : 'Underlying Layer'}</span>
                  <BlendIfSlider range={effects.blendIf[side]} onChange={(next) => patchEffects('blendIf', { [side]: next } as never)} />
                </div>
              ))}
            </>
          )}

          {(section === 'dropShadow' || section === 'innerShadow') && (() => {
            const key = section;
            const s = effects[key];
            return (
              <>
                <BlendModeSelect value={s.blendMode} onChange={(v) => patchEffects(key, { blendMode: v })} />
                <ColorRow label="Color" value={s.color} onChange={(v) => patchEffects(key, { color: v })} />
                <Slider label="Opacity" min={0} max={100} value={s.opacity} onChange={(v) => patchEffects(key, { opacity: v })} />
                <Slider label="Angle" min={0} max={360} value={s.angle} onChange={(v) => patchEffects(key, { angle: v })} />
                <CheckboxRow label="Use Global Light" checked={s.useGlobalLight} onChange={(v) => patchEffects(key, { useGlobalLight: v })} />
                <Slider label="Distance" min={0} max={999} value={s.distance} onChange={(v) => patchEffects(key, { distance: v })} />
                <Slider label="Spread" min={0} max={100} value={s.spread} onChange={(v) => patchEffects(key, { spread: v })} />
                <Slider label="Size" min={0} max={999} value={s.size} onChange={(v) => patchEffects(key, { size: v })} />
                <Slider label="Noise" min={0} max={100} value={s.noise} onChange={(v) => patchEffects(key, { noise: v })} />
                {key === 'dropShadow' && (
                  <CheckboxRow label="Layer Knocks Out Drop Shadow" checked={s.layerKnocksOut ?? false} onChange={(v) => patchEffects(key, { layerKnocksOut: v })} />
                )}
              </>
            );
          })()}

          {(section === 'outerGlow' || section === 'innerGlow') && (() => {
            const key = section;
            const g = effects[key];
            return (
              <>
                <BlendModeSelect value={g.blendMode} onChange={(v) => patchEffects(key, { blendMode: v })} />
                <Slider label="Opacity" min={0} max={100} value={g.opacity} onChange={(v) => patchEffects(key, { opacity: v })} />
                <Slider label="Noise" min={0} max={100} value={g.noise} onChange={(v) => patchEffects(key, { noise: v })} />
                <ColorRow label="Color" value={g.color} onChange={(v) => patchEffects(key, { color: v })} />
                <ChannelTabs options={[{ id: 'softer', label: 'Softer' }, { id: 'precise', label: 'Precise' }]} value={g.technique} onChange={(v) => patchEffects(key, { technique: v })} />
                <Slider label="Spread" min={0} max={100} value={g.spread} onChange={(v) => patchEffects(key, { spread: v })} />
                <Slider label="Size" min={1} max={999} value={g.size} onChange={(v) => patchEffects(key, { size: v })} />
                <Slider label="Range" min={1} max={100} value={g.range} onChange={(v) => patchEffects(key, { range: v })} />
                <Slider label="Jitter" min={0} max={100} value={g.jitter} onChange={(v) => patchEffects(key, { jitter: v })} />
                {key === 'innerGlow' && (
                  <ChannelTabs options={[{ id: 'center', label: 'Center' }, { id: 'edge', label: 'Edge' }]} value={g.source ?? 'edge'} onChange={(v) => patchEffects(key, { source: v })} />
                )}
              </>
            );
          })()}

          {section === 'bevelEmboss' && (
            <>
              <label className="flex flex-col gap-1 text-micro text-ink-faint">
                <span>Style</span>
                <select
                  value={effects.bevelEmboss.style}
                  onChange={(e) => patchEffects('bevelEmboss', { style: e.target.value as LayerEffects['bevelEmboss']['style'] })}
                  className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
                >
                  <option value="outer-bevel">Outer Bevel</option>
                  <option value="inner-bevel">Inner Bevel</option>
                  <option value="emboss">Emboss</option>
                  <option value="pillow-emboss">Pillow Emboss</option>
                  <option value="stroke-emboss">Stroke Emboss</option>
                </select>
              </label>
              <ChannelTabs
                options={[{ id: 'smooth', label: 'Smooth' }, { id: 'chisel-hard', label: 'Chisel Hard' }, { id: 'chisel-soft', label: 'Chisel Soft' }]}
                value={effects.bevelEmboss.technique}
                onChange={(v) => patchEffects('bevelEmboss', { technique: v })}
              />
              <Slider label="Depth" min={1} max={1000} value={effects.bevelEmboss.depth} onChange={(v) => patchEffects('bevelEmboss', { depth: v })} />
              <ChannelTabs options={[{ id: 'up', label: 'Up' }, { id: 'down', label: 'Down' }]} value={effects.bevelEmboss.direction} onChange={(v) => patchEffects('bevelEmboss', { direction: v })} />
              <Slider label="Size" min={0} max={999} value={effects.bevelEmboss.size} onChange={(v) => patchEffects('bevelEmboss', { size: v })} />
              <Slider label="Soften" min={0} max={16} value={effects.bevelEmboss.soften} onChange={(v) => patchEffects('bevelEmboss', { soften: v })} />
              <Slider label="Angle" min={0} max={360} value={effects.bevelEmboss.angle} onChange={(v) => patchEffects('bevelEmboss', { angle: v })} />
              <Slider label="Altitude" min={0} max={90} value={effects.bevelEmboss.altitude} onChange={(v) => patchEffects('bevelEmboss', { altitude: v })} />
              <span className="text-micro text-ink-faint uppercase tracking-wide pt-1">Highlight</span>
              <BlendModeSelect value={effects.bevelEmboss.highlightMode} onChange={(v) => patchEffects('bevelEmboss', { highlightMode: v })} />
              <ColorRow label="Color" value={effects.bevelEmboss.highlightColor} onChange={(v) => patchEffects('bevelEmboss', { highlightColor: v })} />
              <Slider label="Opacity" min={0} max={100} value={effects.bevelEmboss.highlightOpacity} onChange={(v) => patchEffects('bevelEmboss', { highlightOpacity: v })} />
              <span className="text-micro text-ink-faint uppercase tracking-wide pt-1">Shadow</span>
              <BlendModeSelect value={effects.bevelEmboss.shadowMode} onChange={(v) => patchEffects('bevelEmboss', { shadowMode: v })} />
              <ColorRow label="Color" value={effects.bevelEmboss.shadowColor} onChange={(v) => patchEffects('bevelEmboss', { shadowColor: v })} />
              <Slider label="Opacity" min={0} max={100} value={effects.bevelEmboss.shadowOpacity} onChange={(v) => patchEffects('bevelEmboss', { shadowOpacity: v })} />
              <p className="text-micro text-ink-faint/70 pt-1">
                Contour/Texture sub-items are real on/off toggles (left nav) with no dedicated contour-curve/texture-pattern editor in this app yet — enabling them doesn't change the relief math beyond what Style/Technique already control.
              </p>
            </>
          )}

          {section === 'satin' && (
            <>
              <BlendModeSelect value={effects.satin.blendMode} onChange={(v) => patchEffects('satin', { blendMode: v })} />
              <ColorRow label="Color" value={effects.satin.color} onChange={(v) => patchEffects('satin', { color: v })} />
              <Slider label="Opacity" min={0} max={100} value={effects.satin.opacity} onChange={(v) => patchEffects('satin', { opacity: v })} />
              <Slider label="Angle" min={0} max={360} value={effects.satin.angle} onChange={(v) => patchEffects('satin', { angle: v })} />
              <Slider label="Distance" min={0} max={999} value={effects.satin.distance} onChange={(v) => patchEffects('satin', { distance: v })} />
              <Slider label="Size" min={0} max={999} value={effects.satin.size} onChange={(v) => patchEffects('satin', { size: v })} />
              <CheckboxRow label="Invert" checked={effects.satin.invert} onChange={(v) => patchEffects('satin', { invert: v })} />
            </>
          )}

          {section === 'colorOverlay' && (
            <>
              <BlendModeSelect value={effects.colorOverlay.blendMode} onChange={(v) => patchEffects('colorOverlay', { blendMode: v })} />
              <ColorRow label="Color" value={effects.colorOverlay.color} onChange={(v) => patchEffects('colorOverlay', { color: v })} />
              <Slider label="Opacity" min={0} max={100} value={effects.colorOverlay.opacity} onChange={(v) => patchEffects('colorOverlay', { opacity: v })} />
            </>
          )}

          {section === 'gradientOverlay' && (
            <>
              <BlendModeSelect value={effects.gradientOverlay.blendMode} onChange={(v) => patchEffects('gradientOverlay', { blendMode: v })} />
              <Slider label="Opacity" min={0} max={100} value={effects.gradientOverlay.opacity} onChange={(v) => patchEffects('gradientOverlay', { opacity: v })} />
              <div
                className="h-6 rounded-control border border-hairline"
                style={{ background: `linear-gradient(to right, ${effects.gradientOverlay.gradient.from}, ${effects.gradientOverlay.gradient.to})` }}
              />
              <div className="flex items-center gap-3">
                <ColorRow label="From" value={effects.gradientOverlay.gradient.from} onChange={(v) => patchEffects('gradientOverlay', { gradient: { ...effects.gradientOverlay.gradient, from: v } })} />
                <ColorRow label="To" value={effects.gradientOverlay.gradient.to} onChange={(v) => patchEffects('gradientOverlay', { gradient: { ...effects.gradientOverlay.gradient, to: v } })} />
              </div>
              <label className="flex flex-col gap-1 text-micro text-ink-faint">
                <span>Style</span>
                <select
                  value={effects.gradientOverlay.style}
                  onChange={(e) => patchEffects('gradientOverlay', { style: e.target.value as LayerEffects['gradientOverlay']['style'] })}
                  className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
                >
                  <option value="linear">Linear</option>
                  <option value="radial">Radial</option>
                  <option value="angle">Angle</option>
                  <option value="reflected">Reflected</option>
                  <option value="diamond">Diamond</option>
                </select>
              </label>
              <CheckboxRow label="Align with Layer" checked={effects.gradientOverlay.alignWithLayer} onChange={(v) => patchEffects('gradientOverlay', { alignWithLayer: v })} />
              <Slider label="Angle" min={0} max={360} value={effects.gradientOverlay.angle} onChange={(v) => patchEffects('gradientOverlay', { angle: v })} />
              <Slider label="Scale" min={10} max={150} value={effects.gradientOverlay.scale} onChange={(v) => patchEffects('gradientOverlay', { scale: v })} />
            </>
          )}

          {section === 'patternOverlay' && (
            <>
              <p className="text-micro text-ink-faint/70">No pattern-asset library exists in this app yet.</p>
              <BlendModeSelect value={effects.patternOverlay.blendMode} onChange={(v) => patchEffects('patternOverlay', { blendMode: v })} />
              <Slider label="Opacity" min={0} max={100} value={effects.patternOverlay.opacity} onChange={(v) => patchEffects('patternOverlay', { opacity: v })} />
              <div className="text-micro text-ink-faint border border-dashed border-hairline rounded-control px-3 py-4 text-center">No patterns available</div>
              <Slider label="Scale" min={1} max={1000} value={effects.patternOverlay.scale} onChange={(v) => patchEffects('patternOverlay', { scale: v })} />
              <CheckboxRow label="Link with Layer" checked={effects.patternOverlay.linkWithLayer} onChange={(v) => patchEffects('patternOverlay', { linkWithLayer: v })} />
            </>
          )}

          {section === 'stroke' && (
            <>
              <Slider label="Size" min={1} max={999} value={effects.stroke.size} onChange={(v) => patchEffects('stroke', { size: v })} />
              <ChannelTabs
                options={[{ id: 'outside', label: 'Outside' }, { id: 'inside', label: 'Inside' }, { id: 'center', label: 'Center' }]}
                value={effects.stroke.position}
                onChange={(v) => patchEffects('stroke', { position: v })}
              />
              <BlendModeSelect value={effects.stroke.blendMode} onChange={(v) => patchEffects('stroke', { blendMode: v })} />
              <Slider label="Opacity" min={0} max={100} value={effects.stroke.opacity} onChange={(v) => patchEffects('stroke', { opacity: v })} />
              <label className="flex flex-col gap-1 text-micro text-ink-faint">
                <span>Fill Type</span>
                <select
                  value={effects.stroke.fillType}
                  onChange={(e) => patchEffects('stroke', { fillType: e.target.value as LayerEffects['stroke']['fillType'] })}
                  className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
                >
                  <option value="color">Color</option>
                  <option value="gradient">Gradient</option>
                  <option value="pattern">Pattern</option>
                </select>
              </label>
              {effects.stroke.fillType === 'color' && (
                <ColorRow label="Color" value={effects.stroke.color} onChange={(v) => patchEffects('stroke', { color: v })} />
              )}
              {effects.stroke.fillType === 'gradient' && (
                <div className="flex items-center gap-3">
                  <ColorRow label="From" value={effects.stroke.gradient.from} onChange={(v) => patchEffects('stroke', { gradient: { ...effects.stroke.gradient, from: v } })} />
                  <ColorRow label="To" value={effects.stroke.gradient.to} onChange={(v) => patchEffects('stroke', { gradient: { ...effects.stroke.gradient, to: v } })} />
                </div>
              )}
              {effects.stroke.fillType === 'pattern' && (
                <div className="text-micro text-ink-faint border border-dashed border-hairline rounded-control px-3 py-4 text-center">No patterns available</div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
