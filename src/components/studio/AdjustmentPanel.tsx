import { useEffect, useState } from 'react';
import { StudioPanel } from './StudioPanel';
import { Histogram } from './Histogram';
import { CurvesEditor } from './CurvesEditor';
import {
  ADJUSTMENT_KIND_LABEL, HUE_BAND_LIST, HUE_BAND_LABEL, SELECTIVE_COLOR_FAMILY_LIST, SELECTIVE_COLOR_FAMILY_LABEL,
  PHOTO_FILTER_PRESET_LABEL, BUILT_IN_LUT_LABEL,
  type AdjustmentKind, type AdjustmentLayerData, type StudioLayer, type SelectiveColorFamily,
  type PhotoFilterPreset, type BuiltInLut,
} from './studioTypes';
import { curvePresetPoints, autoBlackWhiteWeights, photoFilterPresetColor } from '../../lib/adjustments';
import { computeHistogram, autoLevelsFromHistogram } from '../../lib/histogram';
import { Slider, CheckboxRow, ColorRow, ChannelTabs } from './panelControls';

interface AdjustmentPanelProps {
  layer: StudioLayer;
  onUpdate: (id: string, patch: Partial<AdjustmentLayerData>) => void;
  /** Live pixels for Levels/Threshold's histogram + Auto buttons and Black & White's Auto button —
   *  a getter (not a prop value) since it's expensive-ish and only needed while this panel is
   *  actually open on one of those kinds. */
  getHistogramSource?: () => HTMLCanvasElement | null;
  /** Brightness/Contrast's "Preview" checkbox — reuses the layer's own visibility toggle rather
   *  than a second preview pipeline, matching how every other adjustment already previews live via
   *  the existing Konva filter/cache mechanism. */
  onToggleVisible?: () => void;
  /** Set when hosted inside the right-column panel stack, whose own header already shows the name. */
  hideTitle?: boolean;
}

const KIND_LABELS = ADJUSTMENT_KIND_LABEL;

export function AdjustmentPanel({ layer, onUpdate, getHistogramSource, onToggleVisible, hideTitle }: AdjustmentPanelProps) {
  const data = layer.adjustment;
  const [histogramImage, setHistogramImage] = useState<ImageData | null>(null);

  // Only Levels/Threshold/Black & White (its Auto button) need real pixels — read them lazily once
  // per kind switch rather than on every render, matching FilterDialog.tsx's own
  // snapshot-on-open pattern for one-shot analysis operations.
  useEffect(() => {
    if (!data || !getHistogramSource) { setHistogramImage(null); return; }
    if (data.kind !== 'levels' && data.kind !== 'threshold') { setHistogramImage(null); return; }
    const canvas = getHistogramSource();
    if (!canvas) { setHistogramImage(null); return; }
    const ctx = canvas.getContext('2d');
    setHistogramImage(ctx ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.kind, layer.id]);

  if (!data) return null;

  const set = (patch: Partial<AdjustmentLayerData>) => onUpdate(layer.id, patch);
  const setLevels = (patch: Partial<AdjustmentLayerData['levels']>) => set({ levels: { ...data.levels, ...patch } });

  function runAutoLevels() {
    const canvas = getHistogramSource?.();
    if (!canvas || !data) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const hist = computeHistogram(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const channel = data.levelsChannel;
    const source = channel === 'rgb' ? hist.luminance : hist[channel];
    const { inBlack, inWhite } = autoLevelsFromHistogram(source);
    if (channel === 'rgb') setLevels({ inBlack, inWhite });
    else set({ levelsByChannel: { ...data.levelsByChannel, [channel]: { ...data.levelsByChannel[channel], inBlack, inWhite } } });
  }

  function runAutoBlackWhite() {
    const canvas = getHistogramSource?.();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const weights = autoBlackWhiteWeights(ctx.getImageData(0, 0, canvas.width, canvas.height));
    set({ blackWhite: { ...data.blackWhite, ...weights } });
  }

  return (
    <StudioPanel title="Adjustment" hideTitle={hideTitle}>
        <p className="text-micro text-ink-faint/70 leading-snug">
          Applies to every layer below this one. Move it up or down the stack to change what it affects,
          or lower its opacity to ease it off.
        </p>

        <label className="flex flex-col gap-1 text-micro text-ink-faint">
          <span>Type</span>
          <select
            value={data.kind}
            onChange={(e) => set({ kind: e.target.value as AdjustmentKind })}
            className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
          >
            {(Object.keys(KIND_LABELS) as AdjustmentKind[]).map(k => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
        </label>

        {data.kind === 'brightness-contrast' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Brightness" min={-150} max={150} value={data.brightness} onChange={(v) => set({ brightness: v })} />
            <Slider label="Contrast" min={-50} max={100} value={data.contrast} onChange={(v) => set({ contrast: v })} />
            <CheckboxRow label="Use Legacy" checked={data.useLegacy} onChange={(v) => set({ useLegacy: v })} />
            {onToggleVisible && <CheckboxRow label="Preview" checked={layer.visible} onChange={() => onToggleVisible()} />}
          </div>
        )}

        {data.kind === 'hue-saturation' && (
          <div className="flex flex-col gap-2 pt-1">
            <ChannelTabs
              options={[{ id: 'master', label: 'Master' }, ...HUE_BAND_LIST.map(b => ({ id: b, label: HUE_BAND_LABEL[b] }))]}
              value={data.hueSaturationChannel}
              onChange={(v) => set({ hueSaturationChannel: v })}
            />
            {data.hueSaturationChannel === 'master' ? (
              <>
                <Slider label="Hue" min={-180} max={180} value={data.hue} onChange={(v) => set({ hue: v })} />
                <Slider label="Saturation" min={-100} max={100} value={data.saturation} onChange={(v) => set({ saturation: v })} />
                <Slider label="Lightness" min={-100} max={100} value={data.lightness} onChange={(v) => set({ lightness: v })} />
              </>
            ) : (
              <>
                <Slider
                  label="Hue" min={-180} max={180}
                  value={data.hueSaturationByChannel[data.hueSaturationChannel].hue}
                  onChange={(v) => set({ hueSaturationByChannel: { ...data.hueSaturationByChannel, [data.hueSaturationChannel]: { ...data.hueSaturationByChannel[data.hueSaturationChannel], hue: v } } })}
                />
                <Slider
                  label="Saturation" min={-100} max={100}
                  value={data.hueSaturationByChannel[data.hueSaturationChannel].saturation}
                  onChange={(v) => set({ hueSaturationByChannel: { ...data.hueSaturationByChannel, [data.hueSaturationChannel]: { ...data.hueSaturationByChannel[data.hueSaturationChannel], saturation: v } } })}
                />
                <Slider
                  label="Lightness" min={-100} max={100}
                  value={data.hueSaturationByChannel[data.hueSaturationChannel].lightness}
                  onChange={(v) => set({ hueSaturationByChannel: { ...data.hueSaturationByChannel, [data.hueSaturationChannel]: { ...data.hueSaturationByChannel[data.hueSaturationChannel], lightness: v } } })}
                />
              </>
            )}
            <CheckboxRow label="Colorize" checked={data.colorize} onChange={(v) => set({ colorize: v })} />
            {data.colorize && (
              <>
                <Slider label="Hue" min={0} max={360} value={data.colorizeHue} onChange={(v) => set({ colorizeHue: v })} />
                <Slider label="Saturation" min={0} max={100} value={data.colorizeSaturation} onChange={(v) => set({ colorizeSaturation: v })} />
                <Slider label="Lightness" min={-100} max={100} value={data.colorizeLightness} onChange={(v) => set({ colorizeLightness: v })} />
              </>
            )}
          </div>
        )}

        {data.kind === 'levels' && (() => {
          const channelLevels = data.levelsChannel === 'rgb' ? data.levels : data.levelsByChannel[data.levelsChannel];
          const patchChannel = (patch: Partial<AdjustmentLayerData['levels']>) => {
            if (data.levelsChannel === 'rgb') setLevels(patch);
            else set({ levelsByChannel: { ...data.levelsByChannel, [data.levelsChannel]: { ...channelLevels, ...patch } } });
          };
          return (
            <div className="flex flex-col gap-2 pt-1">
              <ChannelTabs options={[{ id: 'rgb', label: 'RGB' }, { id: 'r', label: 'R' }, { id: 'g', label: 'G' }, { id: 'b', label: 'B' }]} value={data.levelsChannel} onChange={(v) => set({ levelsChannel: v })} />
              <Histogram imageData={histogramImage} channel={data.levelsChannel === 'rgb' ? 'luminance' : data.levelsChannel} />
              <span className="text-micro text-ink-faint uppercase tracking-wide">Input Levels</span>
              <Slider label="Black" min={0} max={253} value={channelLevels.inBlack} onChange={(v) => patchChannel({ inBlack: Math.min(v, channelLevels.inWhite - 1) })} />
              <Slider label="Gamma" min={0.1} max={9.99} step={0.01} value={channelLevels.gamma} onChange={(v) => patchChannel({ gamma: v })} />
              <Slider label="White" min={2} max={255} value={channelLevels.inWhite} onChange={(v) => patchChannel({ inWhite: Math.max(v, channelLevels.inBlack + 1) })} />
              <span className="text-micro text-ink-faint uppercase tracking-wide">Output Levels</span>
              <Slider label="Shadows" min={0} max={254} value={channelLevels.outBlack} onChange={(v) => patchChannel({ outBlack: Math.min(v, channelLevels.outWhite - 1) })} />
              <Slider label="Highlights" min={1} max={255} value={channelLevels.outWhite} onChange={(v) => patchChannel({ outWhite: Math.max(v, channelLevels.outBlack + 1) })} />
              <button type="button" onClick={runAutoLevels} className="self-start text-micro px-2 py-1 rounded-control border border-hairline text-ink hover:bg-ink/5">
                Auto
              </button>
            </div>
          );
        })()}

        {data.kind === 'curves' && (
          <div className="flex flex-col gap-2 pt-1">
            <ChannelTabs
              options={[{ id: 'rgb', label: 'RGB' }, { id: 'r', label: 'R' }, { id: 'g', label: 'G' }, { id: 'b', label: 'B' }, { id: 'luminosity', label: 'Luminosity' }]}
              value={data.curveChannel}
              onChange={(v) => set({ curveChannel: v })}
            />
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>Preset</span>
              <select
                value={data.curvePreset}
                onChange={(e) => {
                  const preset = e.target.value as AdjustmentLayerData['curvePreset'];
                  set({ curvePreset: preset, curves: { ...data.curves, [data.curveChannel]: curvePresetPoints(preset) } });
                }}
                className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
              >
                <option value="default">Default</option>
                <option value="linear">Linear</option>
                <option value="strong-contrast">Strong Contrast</option>
                <option value="darker">Darker</option>
                <option value="lighter">Lighter</option>
              </select>
            </label>
            <CurvesEditor
              points={data.curves[data.curveChannel]}
              onChange={(points) => set({ curves: { ...data.curves, [data.curveChannel]: points } })}
            />
          </div>
        )}

        {data.kind === 'exposure' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Exposure" min={-20} max={20} step={0.1} value={data.exposure} onChange={(v) => set({ exposure: v })} />
            <Slider label="Offset" min={-0.5} max={0.5} step={0.01} value={data.exposureOffset} onChange={(v) => set({ exposureOffset: v })} />
            <Slider label="Gamma" min={0.1} max={9.99} step={0.01} value={data.exposureGamma} onChange={(v) => set({ exposureGamma: v })} />
          </div>
        )}

        {data.kind === 'vibrance' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Vibrance" min={-100} max={100} value={data.vibrance} onChange={(v) => set({ vibrance: v })} />
          </div>
        )}

        {data.kind === 'color-balance' && (
          <div className="flex flex-col gap-3 pt-1">
            {(['shadows', 'midtones', 'highlights'] as const).map(range => (
              <div key={range} className="flex flex-col gap-1.5">
                <span className="text-micro text-ink-faint capitalize">{range}</span>
                <Slider
                  label="Cyan-Red" min={-100} max={100} value={data.colorBalance[range].cyanRed}
                  onChange={(v) => set({ colorBalance: { ...data.colorBalance, [range]: { ...data.colorBalance[range], cyanRed: v } } })}
                />
                <Slider
                  label="Magenta-Green" min={-100} max={100} value={data.colorBalance[range].magentaGreen}
                  onChange={(v) => set({ colorBalance: { ...data.colorBalance, [range]: { ...data.colorBalance[range], magentaGreen: v } } })}
                />
                <Slider
                  label="Yellow-Blue" min={-100} max={100} value={data.colorBalance[range].yellowBlue}
                  onChange={(v) => set({ colorBalance: { ...data.colorBalance, [range]: { ...data.colorBalance[range], yellowBlue: v } } })}
                />
              </div>
            ))}
            <CheckboxRow label="Preserve luminosity" checked={data.colorBalance.preserveLuminosity} onChange={(v) => set({ colorBalance: { ...data.colorBalance, preserveLuminosity: v } })} />
          </div>
        )}

        {data.kind === 'posterize' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Levels" min={2} max={255} value={data.posterizeLevels} onChange={(v) => set({ posterizeLevels: v })} />
          </div>
        )}

        {data.kind === 'threshold' && (
          <div className="flex flex-col gap-2 pt-1">
            <Histogram imageData={histogramImage} />
            <Slider label="Threshold" min={0} max={255} value={data.threshold} onChange={(v) => set({ threshold: v })} />
          </div>
        )}

        {data.kind === 'gradient-map' && (
          <div className="flex flex-col gap-2 pt-1">
            <div
              className="h-6 rounded-control border border-hairline"
              style={{ background: `linear-gradient(to right, ${data.gradientMap.from}, ${data.gradientMap.to})` }}
            />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-micro text-ink-faint flex-1">
                <span className="w-8 shrink-0">From</span>
                <input
                  type="color"
                  value={data.gradientMap.from}
                  onChange={(e) => set({ gradientMap: { ...data.gradientMap, from: e.target.value } })}
                  className="flex-1 h-7 rounded-control border border-hairline bg-transparent"
                />
              </label>
              <label className="flex items-center gap-2 text-micro text-ink-faint flex-1">
                <span className="w-8 shrink-0">To</span>
                <input
                  type="color"
                  value={data.gradientMap.to}
                  onChange={(e) => set({ gradientMap: { ...data.gradientMap, to: e.target.value } })}
                  className="flex-1 h-7 rounded-control border border-hairline bg-transparent"
                />
              </label>
            </div>
            <CheckboxRow label="Dither" checked={data.gradientMap.dither} onChange={(v) => set({ gradientMap: { ...data.gradientMap, dither: v } })} />
            <CheckboxRow label="Reverse" checked={data.gradientMap.reverse} onChange={(v) => set({ gradientMap: { ...data.gradientMap, reverse: v } })} />
          </div>
        )}

        {data.kind === 'black-white' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Reds" min={-200} max={300} value={data.blackWhite.reds} onChange={(v) => set({ blackWhite: { ...data.blackWhite, reds: v } })} />
            <Slider label="Yellows" min={-200} max={300} value={data.blackWhite.yellows} onChange={(v) => set({ blackWhite: { ...data.blackWhite, yellows: v } })} />
            <Slider label="Greens" min={-200} max={300} value={data.blackWhite.greens} onChange={(v) => set({ blackWhite: { ...data.blackWhite, greens: v } })} />
            <Slider label="Cyans" min={-200} max={300} value={data.blackWhite.cyans} onChange={(v) => set({ blackWhite: { ...data.blackWhite, cyans: v } })} />
            <Slider label="Blues" min={-200} max={300} value={data.blackWhite.blues} onChange={(v) => set({ blackWhite: { ...data.blackWhite, blues: v } })} />
            <Slider label="Magentas" min={-200} max={300} value={data.blackWhite.magentas} onChange={(v) => set({ blackWhite: { ...data.blackWhite, magentas: v } })} />
            <button type="button" onClick={runAutoBlackWhite} className="self-start text-micro px-2 py-1 rounded-control border border-hairline text-ink hover:bg-ink/5">
              Auto
            </button>
            <CheckboxRow label="Tint" checked={data.blackWhite.tint} onChange={(v) => set({ blackWhite: { ...data.blackWhite, tint: v } })} />
            {data.blackWhite.tint && (
              <ColorRow label="Tint Color" value={data.blackWhite.tintColor} onChange={(v) => set({ blackWhite: { ...data.blackWhite, tintColor: v } })} />
            )}
          </div>
        )}

        {data.kind === 'photo-filter' && (
          <div className="flex flex-col gap-2 pt-1">
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>Filter</span>
              <select
                value={data.photoFilter.preset}
                onChange={(e) => {
                  const preset = e.target.value as PhotoFilterPreset;
                  const presetColor = photoFilterPresetColor(preset);
                  set({ photoFilter: { ...data.photoFilter, preset, color: presetColor ?? data.photoFilter.color } });
                }}
                className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
              >
                {(Object.keys(PHOTO_FILTER_PRESET_LABEL) as PhotoFilterPreset[]).map(p => (
                  <option key={p} value={p}>{PHOTO_FILTER_PRESET_LABEL[p]}</option>
                ))}
              </select>
            </label>
            {data.photoFilter.preset === 'custom' && (
              <ColorRow label="Color" value={data.photoFilter.color} onChange={(v) => set({ photoFilter: { ...data.photoFilter, color: v } })} />
            )}
            <Slider label="Density" min={1} max={100} value={data.photoFilter.density} onChange={(v) => set({ photoFilter: { ...data.photoFilter, density: v } })} />
            <CheckboxRow label="Preserve Luminosity" checked={data.photoFilter.preserveLuminosity} onChange={(v) => set({ photoFilter: { ...data.photoFilter, preserveLuminosity: v } })} />
          </div>
        )}

        {data.kind === 'channel-mixer' && (() => {
          const outputs: { id: 'red' | 'green' | 'blue'; label: string }[] = [{ id: 'red', label: 'Red' }, { id: 'green', label: 'Green' }, { id: 'blue', label: 'Blue' }];
          const [outputChannel, setOutputChannel] = useState<'red' | 'green' | 'blue'>('red');
          const mix = data.channelMixer[outputChannel];
          return (
            <div className="flex flex-col gap-2 pt-1">
              <CheckboxRow label="Monochrome" checked={data.channelMixer.monochrome} onChange={(v) => set({ channelMixer: { ...data.channelMixer, monochrome: v } })} />
              {!data.channelMixer.monochrome && (
                <ChannelTabs options={outputs} value={outputChannel} onChange={(v) => setOutputChannel(v)} />
              )}
              <Slider label="Red" min={-200} max={200} value={mix.red} onChange={(v) => set({ channelMixer: { ...data.channelMixer, [outputChannel]: { ...mix, red: v } } })} />
              <Slider label="Green" min={-200} max={200} value={mix.green} onChange={(v) => set({ channelMixer: { ...data.channelMixer, [outputChannel]: { ...mix, green: v } } })} />
              <Slider label="Blue" min={-200} max={200} value={mix.blue} onChange={(v) => set({ channelMixer: { ...data.channelMixer, [outputChannel]: { ...mix, blue: v } } })} />
              <Slider label="Constant" min={-100} max={100} value={mix.constant} onChange={(v) => set({ channelMixer: { ...data.channelMixer, [outputChannel]: { ...mix, constant: v } } })} />
            </div>
          );
        })()}

        {data.kind === 'color-lookup' && (
          <div className="flex flex-col gap-2 pt-1">
            <p className="text-micro text-ink-faint/70 leading-snug">
              No .cube 3D LUT file support in this app — a small set of real, built-in color grades instead.
            </p>
            <label className="flex flex-col gap-1 text-micro text-ink-faint">
              <span>3D LUT</span>
              <select
                value={data.colorLookup.lutId ?? ''}
                onChange={(e) => set({ colorLookup: { lutId: (e.target.value || null) as BuiltInLut | null } })}
                className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
              >
                <option value="">None</option>
                {(Object.keys(BUILT_IN_LUT_LABEL) as BuiltInLut[]).map(id => (
                  <option key={id} value={id}>{BUILT_IN_LUT_LABEL[id]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-micro text-ink-faint opacity-40">
              <span>Type</span>
              <select disabled className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro">
                <option>Abstract</option>
                <option>Device Link</option>
              </select>
            </label>
          </div>
        )}

        {data.kind === 'invert' && (
          <p className="text-micro text-ink-faint pt-1">Inverts every pixel below this layer. No controls.</p>
        )}

        {data.kind === 'selective-color' && (() => {
          const [family, setFamily] = useState<SelectiveColorFamily>('reds');
          const ink = data.selectiveColor.colors[family];
          const patchInk = (patch: Partial<typeof ink>) => set({ selectiveColor: { ...data.selectiveColor, colors: { ...data.selectiveColor.colors, [family]: { ...ink, ...patch } } } });
          return (
            <div className="flex flex-col gap-2 pt-1">
              <label className="flex flex-col gap-1 text-micro text-ink-faint">
                <span>Colors</span>
                <select
                  value={family}
                  onChange={(e) => setFamily(e.target.value as SelectiveColorFamily)}
                  className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
                >
                  {SELECTIVE_COLOR_FAMILY_LIST.map(f => <option key={f} value={f}>{SELECTIVE_COLOR_FAMILY_LABEL[f]}</option>)}
                </select>
              </label>
              <Slider label="Cyan" min={-100} max={100} value={ink.cyan} onChange={(v) => patchInk({ cyan: v })} />
              <Slider label="Magenta" min={-100} max={100} value={ink.magenta} onChange={(v) => patchInk({ magenta: v })} />
              <Slider label="Yellow" min={-100} max={100} value={ink.yellow} onChange={(v) => patchInk({ yellow: v })} />
              <Slider label="Black" min={-100} max={100} value={ink.black} onChange={(v) => patchInk({ black: v })} />
              <ChannelTabs options={[{ id: 'relative', label: 'Relative' }, { id: 'absolute', label: 'Absolute' }]} value={data.selectiveColor.method} onChange={(v) => set({ selectiveColor: { ...data.selectiveColor, method: v } })} />
            </div>
          );
        })()}

        {data.kind === 'shadows-highlights' && (
          <div className="flex flex-col gap-3 pt-1">
            <div className="flex flex-col gap-1.5">
              <span className="text-micro text-ink-faint uppercase tracking-wide">Shadows</span>
              <Slider label="Amount" min={0} max={100} value={data.shadowsHighlights.shadowsAmount} onChange={(v) => set({ shadowsHighlights: { ...data.shadowsHighlights, shadowsAmount: v } })} />
              <Slider label="Tone" min={0} max={100} value={data.shadowsHighlights.shadowsTone} onChange={(v) => set({ shadowsHighlights: { ...data.shadowsHighlights, shadowsTone: v } })} />
              <Slider label="Radius" min={1} max={2500} value={data.shadowsHighlights.shadowsRadius} onChange={(v) => set({ shadowsHighlights: { ...data.shadowsHighlights, shadowsRadius: v } })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-micro text-ink-faint uppercase tracking-wide">Highlights</span>
              <Slider label="Amount" min={0} max={100} value={data.shadowsHighlights.highlightsAmount} onChange={(v) => set({ shadowsHighlights: { ...data.shadowsHighlights, highlightsAmount: v } })} />
              <Slider label="Tone" min={0} max={100} value={data.shadowsHighlights.highlightsTone} onChange={(v) => set({ shadowsHighlights: { ...data.shadowsHighlights, highlightsTone: v } })} />
              <Slider label="Radius" min={1} max={2500} value={data.shadowsHighlights.highlightsRadius} onChange={(v) => set({ shadowsHighlights: { ...data.shadowsHighlights, highlightsRadius: v } })} />
            </div>
            <Slider label="Color Correction" min={-100} max={100} value={data.shadowsHighlights.colorCorrection} onChange={(v) => set({ shadowsHighlights: { ...data.shadowsHighlights, colorCorrection: v } })} />
            <Slider label="Midtone Contrast" min={-100} max={100} value={data.shadowsHighlights.midtoneContrast} onChange={(v) => set({ shadowsHighlights: { ...data.shadowsHighlights, midtoneContrast: v } })} />
          </div>
        )}

        {data.kind === 'hdr-toning' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Glow Radius" min={1} max={500} value={data.hdrToning.edgeGlowRadius} onChange={(v) => set({ hdrToning: { ...data.hdrToning, edgeGlowRadius: v } })} />
            <Slider label="Glow Strength" min={0} max={100} value={data.hdrToning.edgeGlowStrength} onChange={(v) => set({ hdrToning: { ...data.hdrToning, edgeGlowStrength: v } })} />
            <Slider label="Gamma" min={0.1} max={10} step={0.1} value={data.hdrToning.gamma} onChange={(v) => set({ hdrToning: { ...data.hdrToning, gamma: v } })} />
            <Slider label="Exposure" min={-10} max={10} step={0.1} value={data.hdrToning.exposure} onChange={(v) => set({ hdrToning: { ...data.hdrToning, exposure: v } })} />
          </div>
        )}
    </StudioPanel>
  );
}
