import type { LucideIcon } from 'lucide-react';
import {
  Image as ImageIcon, Type, Eraser, SlidersHorizontal, Folder, PenTool,
  Contrast, Palette, Spline, Sun, Droplets, Scale, Grid2x2, CircleDot, Blend,
  Aperture, Camera, Shuffle, Table2, FlipHorizontal2, Paintbrush2, CloudSun, Sparkles,
} from 'lucide-react';
import type { Point } from './paint/selection';

export type BlendMode =
  | 'normal' | 'dissolve'
  | 'darken' | 'multiply' | 'color-burn' | 'linear-burn' | 'darker-color'
  | 'lighten' | 'screen' | 'color-dodge' | 'linear-dodge' | 'lighter-color'
  | 'overlay' | 'soft-light' | 'hard-light' | 'vivid-light' | 'linear-light' | 'pin-light' | 'hard-mix'
  | 'difference' | 'exclusion' | 'subtract' | 'divide'
  | 'hue' | 'saturation' | 'color' | 'luminosity';

/** Photoshop's real ~27-mode grouping/order, kept for the Blending Options dialog's dropdown. */
export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'darken', label: 'Darken' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'color-burn', label: 'Color Burn' },
  { id: 'linear-burn', label: 'Linear Burn' },
  { id: 'darker-color', label: 'Darker Color' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'screen', label: 'Screen' },
  { id: 'color-dodge', label: 'Color Dodge' },
  { id: 'linear-dodge', label: 'Linear Dodge (Add)' },
  { id: 'lighter-color', label: 'Lighter Color' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'soft-light', label: 'Soft Light' },
  { id: 'hard-light', label: 'Hard Light' },
  { id: 'vivid-light', label: 'Vivid Light' },
  { id: 'linear-light', label: 'Linear Light' },
  { id: 'pin-light', label: 'Pin Light' },
  { id: 'hard-mix', label: 'Hard Mix' },
  { id: 'difference', label: 'Difference' },
  { id: 'exclusion', label: 'Exclusion' },
  { id: 'subtract', label: 'Subtract' },
  { id: 'divide', label: 'Divide' },
  { id: 'hue', label: 'Hue' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'color', label: 'Color' },
  { id: 'luminosity', label: 'Luminosity' },
];

/** Maps our blend mode ids to Konva's (the browser canvas's) native `globalCompositeOperation`
 *  values — 17 of Photoshop's ~27 modes have a real native equivalent. The other 10 (see
 *  `CUSTOM_BLEND_MODES`) have no native composite-operation string and need real per-pixel math
 *  instead (`lib/customBlendModes.ts`), applied as a filter rather than this map. */
export const BLEND_TO_COMPOSITE: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: 'source-over',
  darken: 'darken',
  multiply: 'multiply',
  'color-burn': 'color-burn',
  lighten: 'lighten',
  screen: 'screen',
  'color-dodge': 'color-dodge',
  'linear-dodge': 'lighter',
  overlay: 'overlay',
  'soft-light': 'soft-light',
  'hard-light': 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

/** The 10 modes with no native `globalCompositeOperation` equivalent — real per-pixel formulas
 *  live in `lib/customBlendModes.ts`, dispatched by `StudioCanvas.tsx`'s render path instead of
 *  `BLEND_TO_COMPOSITE`. */
export const CUSTOM_BLEND_MODES = new Set<BlendMode>([
  'dissolve', 'linear-burn', 'darker-color', 'lighter-color',
  'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'subtract', 'divide',
]);

/**
 * The native composite operation for `mode`, or `'source-over'` for a custom mode that has none.
 * This is the *live-canvas* story only: Konva's per-node model only ever composites a node against
 * its own cached pixels, never the backdrop, so a genuine custom-mode blend (which by definition
 * needs the backdrop) can't run as a per-node filter without much deeper surgery than this session
 * scopes. A custom-mode layer therefore previews as Normal on screen — a known, honest limitation,
 * not a silent one (the Blending Options dialog says so). `lib/exportImage.ts`'s flatten path is
 * where custom modes get their real per-pixel treatment instead (`lib/customBlendModes.ts`), since
 * flatten export already composites everything sequentially onto one real 2D context with the
 * backdrop naturally available at every step.
 */
export function compositeOperationFor(mode: BlendMode): GlobalCompositeOperation {
  return BLEND_TO_COMPOSITE[mode] ?? 'source-over';
}

export type StudioLayerType = 'background' | 'clean-patch' | 'text' | 'adjustment' | 'group' | 'path' | 'placed-image';

/** How a click changes the canvas selection: plain click replaces it, Shift/Ctrl-click toggles. */
export type LayerSelectMode = 'replace' | 'toggle';

export const LAYER_TYPE_ICON: Record<StudioLayerType, LucideIcon> = {
  background: ImageIcon,
  'clean-patch': Eraser,
  text: Type,
  adjustment: SlidersHorizontal,
  group: Folder,
  path: PenTool,
  'placed-image': ImageIcon,
};

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

/** A readable mirror of `TextLayerData.autoWidth` ('point' === autoWidth true, 'area' === false).
 *  `autoWidth` remains the single field layout/reflow logic (textLayout.ts, TextLayerNode.tsx)
 *  branches on — `textMode` is kept in sync wherever `autoWidth` is written, never read for layout
 *  decisions itself. */
export type TextMode = 'point' | 'area';
export function textModeFor(autoWidth: boolean): TextMode {
  return autoWidth ? 'point' : 'area';
}

export const FONT_FAMILIES = [
  'Anime Ace', 'CC Wild Words', 'Comic Sans MS', 'Arial', 'Georgia', 'Impact',
];

export type TranslationStatus = 'draft' | 'translated' | 'reviewed';

export interface TextShadow {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

/** Linear gradient fill. When enabled it overrides the flat `color` fill. */
export interface TextGradient {
  enabled: boolean;
  from: string;
  to: string;
  /** Degrees clockwise from left-to-right, matching the panel's control. */
  angle: number;
}

/**
 * Character-level overrides for a span of `content`.
 *
 * Runs are contiguous and cover `content` exactly — `sum(run.length) === content.length`. A run
 * with no overrides just renders in the layer's own style, so plain text is one full-length empty
 * run. `textRuns.ts` owns that invariant; don't hand-edit `runs` anywhere else.
 *
 * Only the properties Photoshop treats as *character* properties live here. Stroke, shadow/glow and
 * gradient are layer effects, and align/lineHeight/wrap are paragraph properties — those stay on
 * TextLayerData. This split is also what maps onto ag-psd's `styleRuns` for PSD export.
 */
export interface TextRun {
  length: number;
  fontFamily?: string;
  fontSize?: number;
  /** Falls back to `bold ? 700 : 400`. Families that ship a single weight get browser synthesis. */
  fontWeight?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Tracking within this run (extra px between characters). */
  letterSpacing?: number;
  /**
   * Extra px inserted *before* this run — Photoshop's manual kern, which is applied at a caret
   * position between two characters. A caret position is exactly a run boundary, which is what
   * makes "advance before the run" a faithful model rather than an approximation.
   */
  kerning?: number;
  /** Raises (+) or lowers (-) this run off the baseline. */
  baselineShift?: number;
}

/**
 * A single wrapped line's overrides, independent from `TextRun` (per-character). Keyed by the
 * line's index in the *current* wrapped layout (`textLayout.ts`'s `layoutText`) — reflowing the
 * layer (edited content, resized frame) can shift what's on which line, same trade-off `runs`
 * would have without `textRuns.ts`'s reflow-by-diff, but line overrides are a coarser, occasional
 * tool (balancing one bubble line against another) rather than something edited every keystroke.
 */
export interface LineStyleOverride {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  letterSpacing?: number;
  align?: TextAlign;
}

/**
 * A shape a text layer's live rendering (and flattened export) clips to, in the same image-space
 * coordinates as the layer's own x/y — set when Type Region converts a non-rectangular selection
 * into a text container. Rect needs no entry (the frame itself already is the rect); a mask-kind
 * selection has no clean vector form to persist, so Type Region falls back to a plain rectangular
 * container for those rather than storing one (a documented gap, not silently dropped pixels).
 */
export type TextClipShape =
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number }
  | { kind: 'polygon'; points: { x: number; y: number }[] };

export interface TextLayerData {
  content: string;
  x: number;
  y: number;
  width: number;
  fontFamily: string;
  fontSize: number;
  color: string;
  align: TextAlign;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  lineHeight: number;
  strokeColor: string;
  strokeWidth: number;
  rotation: number;
  /**
   * Point text (Photoshop's click-to-type) grows to fit its content and never wraps;
   * box text (click-drag) wraps inside a fixed `width`. Stored as a flag rather than
   * width=0 so a point layer keeps a usable width if it's later converted to a box.
   */
  autoWidth: boolean;
  /** Readable mirror of `autoWidth` — see `TextMode`'s own doc comment. Not itself read by any
   *  layout/reflow logic; `autoWidth` stays authoritative. */
  textMode: TextMode;
  /**
   * Area (box) text only: when set, the frame stops growing at this height instead of always
   * auto-sizing to content — `textLayout.ts` reports `overflowing` once laid-out content exceeds
   * it, which the canvas/panel surface as the ⊞ indicator rather than silently clipping.
   */
  fixedHeight?: number;
  /** Area (box) text only, and only meaningful once `fixedHeight` is set: how laid-out content sits
   *  within the frame when it's shorter than `fixedHeight`. Absent means 'top' (the pre-existing
   *  behavior) — see textLayout.ts's layoutAt. */
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** Area (box) text only, and only meaningful once `fixedHeight` is set: binary-searches fontSize
   *  down from the layer's own `fontSize` (a ceiling, never a floor — auto-fit only shrinks) so the
   *  laid-out content fits inside width × fixedHeight. See textLayout.ts's fitFontSizeToBox /
   *  TextLayout.resolvedFontSize. */
  autoFitFontSize?: boolean;
  /** Extra px between characters (Konva `letterSpacing`; canvas 2D letterSpacing on export). */
  letterSpacing: number;
  /** Drop shadow / glow — a glow is just a shadow at offset 0 with a wide blur. */
  shadow: TextShadow;
  /** Gradient fill; overrides `color` while enabled. */
  gradient: TextGradient;
  /** Per-character overrides over the layer style above. See TextRun; maintained by textRuns.ts. */
  runs: TextRun[];
  /** Per-wrapped-line overrides. See LineStyleOverride. */
  lineOverrides?: Record<number, LineStyleOverride>;
  /** Set by Type Region for a non-rectangular container. See TextClipShape. */
  clipShape?: TextClipShape;
  /** Warp Text (Text menu / options bar). Absent or `style: 'none'` means unwarped — rendered the
   *  normal per-run `Konva.Text` way. Stored as settings rather than a baked image so the warp is
   *  re-applied automatically whenever the text's own content/style changes; see textWarp.ts. */
  warp?: WarpTextSettings;
  /** Translator workflow metadata — surfaced in the Translation Preview panel. */
  status: TranslationStatus;
  comment: string;
}

/** Photoshop's Warp Text style list. `'none'` disables warping entirely (the field can also just be
 *  absent for the same effect — both mean "render normally"). */
export type WarpStyle =
  | 'none' | 'arc' | 'arcLower' | 'arcUpper' | 'arch'
  | 'bulge' | 'shellLower' | 'shellUpper' | 'flag'
  | 'wave' | 'fish' | 'rise' | 'fisheye' | 'inflate'
  | 'squeeze' | 'twist';

export interface WarpTextSettings {
  orientation: 'horizontal' | 'vertical';
  style: WarpStyle;
  bend: number; // -100..100
  horizontalDistortion: number; // -100..100
  verticalDistortion: number; // -100..100
}

export function createDefaultWarpSettings(): WarpTextSettings {
  return { orientation: 'horizontal', style: 'none', bend: 50, horizontalDistortion: 0, verticalDistortion: 0 };
}

export const DEFAULT_TEXT_SHADOW: TextShadow = {
  enabled: false, color: '#000000', blur: 6, offsetX: 0, offsetY: 2,
};

export const DEFAULT_TEXT_GRADIENT: TextGradient = {
  enabled: false, from: '#ffffff', to: '#000000', angle: 90,
};

export type AdjustmentKind =
  | 'brightness-contrast' | 'hue-saturation' | 'levels'
  | 'curves' | 'exposure' | 'vibrance' | 'color-balance' | 'posterize' | 'threshold' | 'gradient-map'
  | 'black-white' | 'photo-filter' | 'channel-mixer' | 'color-lookup' | 'invert' | 'selective-color'
  | 'shadows-highlights' | 'hdr-toning';

export const ADJUSTMENT_KIND_LABEL: Record<AdjustmentKind, string> = {
  'brightness-contrast': 'Brightness/Contrast',
  'hue-saturation': 'Hue/Saturation',
  levels: 'Levels',
  curves: 'Curves',
  exposure: 'Exposure',
  vibrance: 'Vibrance',
  'color-balance': 'Color Balance',
  posterize: 'Posterize',
  threshold: 'Threshold',
  'gradient-map': 'Gradient Map',
  'black-white': 'Black & White',
  'photo-filter': 'Photo Filter',
  'channel-mixer': 'Channel Mixer',
  'color-lookup': 'Color Lookup',
  invert: 'Invert',
  'selective-color': 'Selective Color',
  'shadows-highlights': 'Shadows/Highlights',
  'hdr-toning': 'HDR Toning',
};

/** Icon-grid picker (`AdjustmentPickerPopover.tsx`) — one entry per kind, matching Photoshop's own
 *  Adjustments panel icon grid. */
export const ADJUSTMENT_KIND_ICON: Record<AdjustmentKind, LucideIcon> = {
  'brightness-contrast': Contrast,
  'hue-saturation': Palette,
  levels: SlidersHorizontal,
  curves: Spline,
  exposure: Sun,
  vibrance: Droplets,
  'color-balance': Scale,
  posterize: Grid2x2,
  threshold: CircleDot,
  'gradient-map': Blend,
  'black-white': Aperture,
  'photo-filter': Camera,
  'channel-mixer': Shuffle,
  'color-lookup': Table2,
  invert: FlipHorizontal2,
  'selective-color': Paintbrush2,
  'shadows-highlights': CloudSun,
  'hdr-toning': Sparkles,
};

/** One curve control point — `input`/`output` are both 0-255. */
export interface CurvePoint { input: number; output: number; }

/** Cyan-Red / Magenta-Green / Yellow-Blue sliders, each -100..100 — one per Color Balance tonal range. */
export interface ColorBalanceRange { cyanRed: number; magentaGreen: number; yellowBlue: number; }

/** Input/output levels for one channel — same shape whether it's the RGB composite or a single
 *  R/G/B channel, so `levelsFilter`'s per-channel pass and its RGB composite pass share one type. */
export interface LevelsData {
  inBlack: number; // 0-255
  inWhite: number; // 0-255
  gamma: number; // 0.1-9.99
  outBlack: number; // 0-255
  outWhite: number; // 0-255
}

function defaultLevels(): LevelsData {
  return { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
}

/** Photoshop's Hue/Saturation targets one of 6 overlapping hue bands, or "Master" (all pixels
 *  uniformly — the pre-existing `hue`/`saturation`/`lightness` top-level fields). */
export type HueBand = 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas';
export interface HueSatBandValues { hue: number; saturation: number; lightness: number; }
/** Exported so `adjustments.ts`'s shared hue-bucket-membership helper and the panel's channel
 *  selector dropdown both iterate the same 6 bands in the same order, rather than each hardcoding
 *  their own copy. */
export const HUE_BAND_LIST: HueBand[] = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'];
export const HUE_BAND_LABEL: Record<HueBand, string> = {
  reds: 'Reds', yellows: 'Yellows', greens: 'Greens', cyans: 'Cyans', blues: 'Blues', magentas: 'Magentas',
};
function defaultHueSatByChannel(): Record<HueBand, HueSatBandValues> {
  const out = {} as Record<HueBand, HueSatBandValues>;
  for (const band of HUE_BAND_LIST) out[band] = { hue: 0, saturation: 0, lightness: 0 };
  return out;
}

/** Black & White's 6 color-family sliders, Photoshop's own -200..300 range. */
export interface BlackWhiteData {
  reds: number; yellows: number; greens: number; cyans: number; blues: number; magentas: number;
  tint: boolean;
  tintColor: string;
}

export type PhotoFilterPreset =
  | 'warming-85' | 'warming-lba' | 'warming-81' | 'cooling-80' | 'cooling-82'
  | 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'violet' | 'magenta' | 'sepia' | 'custom';

/** Named starting colors for Photo Filter's preset dropdown — approximate real-world color-
 *  temperature-filter hues (Adobe's own exact swatch values aren't published), used only to seed
 *  `PhotoFilterData.color` when a preset (not Custom) is picked. */
export const PHOTO_FILTER_PRESET_COLOR: Record<Exclude<PhotoFilterPreset, 'custom'>, string> = {
  'warming-85': '#F0A030',
  'warming-lba': '#F5CC55',
  'warming-81': '#E9B36E',
  'cooling-80': '#0059B3',
  'cooling-82': '#3FA9D6',
  red: '#FF0000',
  orange: '#FF8000',
  yellow: '#FFFF00',
  green: '#00B300',
  cyan: '#00CCCC',
  blue: '#0000FF',
  violet: '#7F00FF',
  magenta: '#FF00FF',
  sepia: '#6E4B2A',
};

export const PHOTO_FILTER_PRESET_LABEL: Record<PhotoFilterPreset, string> = {
  'warming-85': 'Warming Filter (85)',
  'warming-lba': 'Warming Filter (LBA)',
  'warming-81': 'Warming Filter (81)',
  'cooling-80': 'Cooling Filter (80)',
  'cooling-82': 'Cooling Filter (82)',
  red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', cyan: 'Cyan',
  blue: 'Blue', violet: 'Violet', magenta: 'Magenta', sepia: 'Sepia',
  custom: 'Custom',
};

export interface PhotoFilterData {
  preset: PhotoFilterPreset;
  color: string;
  density: number; // 1-100
  preserveLuminosity: boolean;
}

/** One output channel's mix of the *original* R/G/B (Photoshop's Channel Mixer never chains output
 *  channels off each other's already-mixed values) plus a constant offset. */
export interface ChannelMix { red: number; green: number; blue: number; constant: number; }

export interface ChannelMixerData {
  monochrome: boolean;
  red: ChannelMix;
  green: ChannelMix;
  blue: ChannelMix;
}

/** No `.cube`/3D-LUT file infrastructure exists anywhere in this app (no parser, no asset pipeline)
 *  — `lutId` selects one of a small set of real, hardcoded color-grade transforms baked directly
 *  into `colorLookupFilter` instead (see `lib/adjustments.ts`), which is a genuine, working, if
 *  deliberately small-scoped feature rather than a no-op stub. The original spec's own "3DLUT File
 *  dropdown (if any LUT files are available)" phrasing already anticipates an environment with no
 *  importable LUT files. */
export type BuiltInLut = 'warm' | 'cool' | 'cross-process' | 'bw-high-contrast';
export const BUILT_IN_LUT_LABEL: Record<BuiltInLut, string> = {
  warm: 'Warm', cool: 'Cool', 'cross-process': 'Cross Process', 'bw-high-contrast': 'B&W High Contrast',
};
export interface ColorLookupData { lutId: BuiltInLut | null; }

export type SelectiveColorFamily = 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas' | 'whites' | 'neutrals' | 'blacks';
export interface CmykInk { cyan: number; magenta: number; yellow: number; black: number; }
export const SELECTIVE_COLOR_FAMILY_LIST: SelectiveColorFamily[] = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'];
export const SELECTIVE_COLOR_FAMILY_LABEL: Record<SelectiveColorFamily, string> = {
  reds: 'Reds', yellows: 'Yellows', greens: 'Greens', cyans: 'Cyans', blues: 'Blues', magentas: 'Magentas',
  whites: 'Whites', neutrals: 'Neutrals', blacks: 'Blacks',
};
function defaultSelectiveColors(): Record<SelectiveColorFamily, CmykInk> {
  const out = {} as Record<SelectiveColorFamily, CmykInk>;
  for (const family of SELECTIVE_COLOR_FAMILY_LIST) out[family] = { cyan: 0, magenta: 0, yellow: 0, black: 0 };
  return out;
}
export interface SelectiveColorData {
  method: 'relative' | 'absolute';
  colors: Record<SelectiveColorFamily, CmykInk>;
}

export interface ShadowsHighlightsData {
  shadowsAmount: number; // 0-100
  shadowsTone: number; // 0-100
  shadowsRadius: number; // 1-2500
  highlightsAmount: number; // 0-100
  highlightsTone: number; // 0-100
  highlightsRadius: number; // 1-2500
  colorCorrection: number; // -100..100
  midtoneContrast: number; // -100..100
}

export interface HdrToningData {
  edgeGlowRadius: number; // 1-500
  edgeGlowStrength: number; // 0-100
  gamma: number; // 0.1-10
  exposure: number; // -10..10
}

/**
 * Non-destructive adjustment applied to **everything below it in its parent** — its position in the
 * stack is what it affects. `layerTree.partitionAdjustments` turns each one into a wrapper around
 * the layers beneath it, which both the canvas and `exportImage.ts` then walk.
 *
 * The layer's `opacity` eases the grade (folded into the filter by `adjustments.withStrength`, not
 * applied to the wrapper node — that would fade the page itself to transparent). Its `blendMode` is
 * **not** honoured and `LayersPanel` hides the control: Photoshop blends an adjustment's result
 * against its unadjusted backdrop, and the wrapper contains the very stack that backdrop would come
 * from.
 *
 * One flat interface carries every kind's fields simultaneously (not a discriminated union) —
 * deliberate, matching how the original three kinds were already shaped; a new kind is "add fields +
 * a default + a kind value", never a reshape.
 */
export interface AdjustmentLayerData {
  kind: AdjustmentKind;
  /** -150..150 */
  brightness: number;
  /** -50..100 */
  contrast: number;
  /** Brightness/Contrast only. Legacy is the original flat linear op this app already had; the
   *  non-legacy path is a genuinely different, non-linear algorithm (screen/multiply-style
   *  brightness scale + an S-curve contrast pivot) — a real qualitative match for what
   *  distinguishes Photoshop's Legacy checkbox from its modern default, not a re-labeled copy of
   *  the same math. See `legacyBrightnessContrastFilter`/`modernBrightnessContrastFilter`. */
  useLegacy: boolean;
  /** -180..180 degrees. Hue/Saturation's Master band. */
  hue: number;
  saturation: number;
  lightness: number;
  hueSaturationChannel: 'master' | HueBand;
  hueSaturationByChannel: Record<HueBand, HueSatBandValues>;
  /** Converts to monochrome, then tints with `colorizeHue`/`colorizeSaturation` at flat
   *  `colorizeLightness` — Photoshop's Hue/Saturation "Colorize" checkbox. */
  colorize: boolean;
  colorizeHue: number; // 0-360
  colorizeSaturation: number; // 0-100
  colorizeLightness: number; // -100..100
  levels: LevelsData;
  levelsChannel: 'rgb' | 'r' | 'g' | 'b';
  levelsByChannel: { r: LevelsData; g: LevelsData; b: LevelsData };
  /** Control points, sorted by `input`, identity (no-op) by default. Edited by CurvesEditor.tsx;
   *  `adjustments.ts`'s `curveLut` is the single source of truth for what they render to, shared by
   *  the live filter and the editor's own on-screen preview so the two can't drift. */
  curves: { rgb: CurvePoint[]; r: CurvePoint[]; g: CurvePoint[]; b: CurvePoint[]; luminosity: CurvePoint[] };
  curveChannel: 'rgb' | 'r' | 'g' | 'b' | 'luminosity';
  curvePreset: 'default' | 'linear' | 'strong-contrast' | 'darker' | 'lighter';
  /** ag-psd's ExposureAdjustment field names, reused verbatim so exportPsd needs no renaming. */
  exposure: number; // -20..20 stops
  exposureOffset: number; // -0.5..0.5
  exposureGamma: number; // 0.01..9.99, 1 = identity
  /** -100..100. Boosts low-saturation pixels more than already-saturated ones. */
  vibrance: number;
  colorBalance: {
    shadows: ColorBalanceRange;
    midtones: ColorBalanceRange;
    highlights: ColorBalanceRange;
    preserveLuminosity: boolean;
  };
  /** 2..255 */
  posterizeLevels: number;
  /** 0..255 */
  threshold: number;
  /** Deliberately 2-stop only, matching this app's one Gradient tool (also foreground->background
   *  only) — there's no multi-stop gradient editor anywhere in this codebase yet. */
  gradientMap: { from: string; to: string; dither: boolean; reverse: boolean };
  blackWhite: BlackWhiteData;
  photoFilter: PhotoFilterData;
  channelMixer: ChannelMixerData;
  colorLookup: ColorLookupData;
  selectiveColor: SelectiveColorData;
  shadowsHighlights: ShadowsHighlightsData;
  hdrToning: HdrToningData;
}

export function createDefaultAdjustmentData(kind: AdjustmentKind = 'brightness-contrast'): AdjustmentLayerData {
  return {
    kind,
    brightness: 0,
    contrast: 0,
    useLegacy: true,
    hue: 0,
    saturation: 0,
    lightness: 0,
    hueSaturationChannel: 'master',
    hueSaturationByChannel: defaultHueSatByChannel(),
    colorize: false,
    colorizeHue: 0,
    colorizeSaturation: 25,
    colorizeLightness: 0,
    levels: defaultLevels(),
    levelsChannel: 'rgb',
    levelsByChannel: { r: defaultLevels(), g: defaultLevels(), b: defaultLevels() },
    curves: {
      rgb: [{ input: 0, output: 0 }, { input: 255, output: 255 }],
      r: [{ input: 0, output: 0 }, { input: 255, output: 255 }],
      g: [{ input: 0, output: 0 }, { input: 255, output: 255 }],
      b: [{ input: 0, output: 0 }, { input: 255, output: 255 }],
      luminosity: [{ input: 0, output: 0 }, { input: 255, output: 255 }],
    },
    curveChannel: 'rgb',
    curvePreset: 'default',
    exposure: 0,
    exposureOffset: 0,
    exposureGamma: 1,
    vibrance: 0,
    colorBalance: {
      shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      preserveLuminosity: true,
    },
    posterizeLevels: 4,
    threshold: 128,
    gradientMap: { from: '#000000', to: '#ffffff', dither: false, reverse: false },
    blackWhite: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintColor: '#7a5230' },
    photoFilter: { preset: 'warming-85', color: PHOTO_FILTER_PRESET_COLOR['warming-85'], density: 25, preserveLuminosity: true },
    channelMixer: {
      monochrome: false,
      red: { red: 100, green: 0, blue: 0, constant: 0 },
      green: { red: 0, green: 100, blue: 0, constant: 0 },
      blue: { red: 0, green: 0, blue: 100, constant: 0 },
    },
    colorLookup: { lutId: null },
    selectiveColor: { method: 'relative', colors: defaultSelectiveColors() },
    shadowsHighlights: { shadowsAmount: 35, shadowsTone: 50, shadowsRadius: 30, highlightsAmount: 0, highlightsTone: 50, highlightsRadius: 30, colorCorrection: 20, midtoneContrast: 0 },
    hdrToning: { edgeGlowRadius: 30, edgeGlowStrength: 50, gamma: 1, exposure: 0 },
  };
}

/**
 * A raster mask on a layer. The pixels live in `paint/maskCanvasRegistry.ts` keyed by `id`,
 * mirroring how `paintCanvasRegistry` holds clean-patch pixels — a layer's paint canvas and its
 * mask canvas are two separate registry entries, which is why the mask carries its own id.
 *
 * The canvas is RGBA with the mask in the *alpha* channel, not grayscale RGB, so rendering is a
 * plain `destination-in` composite with no conversion. PSD is the only consumer that wants
 * grayscale, and it converts at that boundary.
 */
export interface LayerMask {
  id: string;
  enabled: boolean;
  /** Unlinked masks don't follow the layer when it moves. Nothing moves raster layers yet. */
  linked: boolean;
  /** Photoshop's Alt-click-the-mask preview. Render-only, never exported. */
  showAlone?: boolean;
}

/**
 * One anchor on a vector path. `handleIn`/`handleOut` are stored as offsets from `point`, not
 * absolute coordinates — translating the whole path is then a pure `point += delta` per anchor
 * with handles untouched, the same convention `translateSelection` already uses for polygon
 * points (paint/selection.ts).
 *
 * `type` is an interaction hint ("keep handles collinear on drag"), not an enforced geometry
 * invariant — Photoshop itself lets you later drag one handle of a smooth anchor to break
 * symmetry while staying collinear, so the data model doesn't police this.
 */
export interface PathAnchor {
  id: string;
  point: Point;
  /** Offset from `point`; absent means no handle on that side (a pure corner). */
  handleIn?: Point;
  handleOut?: Point;
  type: 'corner' | 'smooth';
}

export type PathFillRule = 'nonzero' | 'evenodd';

/** Vector path data — models exactly one open-or-closed subpath (no compound paths). Pure
 *  geometry, deliberately no rasterized pixel cache: a path layer can't be a clip base/target
 *  and can't carry a paintable mask until it's baked onto a raster layer (Stroke Path/Fill Path). */
export interface PathLayerData {
  anchors: PathAnchor[];
  closed: boolean;
  /** `blendMode`/`opacity`/`preserveTransparency` are read by `fillPathOntoCanvas` at bake time —
   *  set by the Fill Path dialog, not exposed anywhere else (a live path's own on-canvas fill, when
   *  `enabled`, is always fully opaque/normal-blend; only the one-shot bake honours them). */
  fill: { enabled: boolean; color: string; blendMode?: BlendMode; opacity?: number; preserveTransparency?: boolean };
  stroke: { enabled: boolean; color: string; width: number };
  fillRule: PathFillRule;
}

/**
 * Placed Image ("Smart Object") data — a raster canvas at the *source image's own natural size*
 * (never the page size, and never resampled by scaling), positioned/scaled/rotated purely via these
 * transform fields. This is what makes the tool non-destructive: repeatedly resizing a placed image
 * up and down never degrades quality, because the underlying pixels are untouched — only the Konva
 * node's own x/y/scaleX/scaleY/rotation change, the same way any vector shape's transform would.
 * "Rasterize Layer" is the one-way conversion out of this into a normal page-sized `clean-patch`
 * layer, baking the current transform into real pixels at last.
 */
export interface PlacedImageLayerData {
  naturalWidth: number;
  naturalHeight: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number; // degrees
}

/** Shadow/Glow's own blend mode + opacity + color, shared shape for all 4 (Drop Shadow, Inner
 *  Shadow, Outer Glow, Inner Glow) since they're all "a blurred/offset copy of this layer's own
 *  silhouette, drawn behind or clipped inside it". */
export interface ShadowStyleData {
  enabled: boolean;
  blendMode: BlendMode;
  color: string;
  opacity: number; // 0-100
  angle: number; // 0-360, degrees
  useGlobalLight: boolean;
  distance: number; // 0-999
  spread: number; // 0-100
  size: number; // 0-999
  noise: number; // 0-100
  /** Drop Shadow only ("Layer Knocks Out Drop Shadow") — Inner Shadow has no equivalent field. */
  layerKnocksOut?: boolean;
}
export interface GlowStyleData {
  enabled: boolean;
  blendMode: BlendMode;
  color: string;
  opacity: number; // 0-100
  noise: number; // 0-100
  technique: 'softer' | 'precise';
  spread: number; // 0-100
  size: number; // 1-999
  range: number; // 1-100
  jitter: number; // 0-100
  /** Inner Glow only. */
  source?: 'center' | 'edge';
}
export interface BevelEmbossData {
  enabled: boolean;
  style: 'outer-bevel' | 'inner-bevel' | 'emboss' | 'pillow-emboss' | 'stroke-emboss';
  technique: 'smooth' | 'chisel-hard' | 'chisel-soft';
  depth: number; // 1-1000
  direction: 'up' | 'down';
  size: number; // 0-999
  soften: number; // 0-16
  angle: number; // 0-360
  altitude: number; // 0-90
  highlightMode: BlendMode;
  highlightColor: string;
  highlightOpacity: number; // 0-100
  shadowMode: BlendMode;
  shadowColor: string;
  shadowOpacity: number; // 0-100
  /** Left-nav sub-items under Bevel & Emboss. Real toggles (see BlendingOptionsDialog), not yet
   *  wired to their own contour-curve/texture-pattern controls beyond the toggle itself — Contour
   *  defaults to the same linear ramp Gradient Map already uses when this app has no dedicated
   *  contour-curve editor; Texture has no pattern-asset infra, same honest-gap status as Pattern
   *  Overlay below. */
  contourEnabled: boolean;
  textureEnabled: boolean;
}
export interface SatinStyleData {
  enabled: boolean;
  blendMode: BlendMode;
  color: string;
  opacity: number; // 0-100
  angle: number; // 0-360
  distance: number; // 0-999
  size: number; // 0-999
  invert: boolean;
}
/** Color Overlay's real shape — ag-psd calls this "solid fill". */
export interface SolidFillStyleData {
  enabled: boolean;
  blendMode: BlendMode;
  color: string;
  opacity: number; // 0-100
}
export interface GradientOverlayStyleData {
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number; // 0-100
  /** Deliberately 2-stop only, matching every other gradient in this app (Gradient tool, Gradient
   *  Map) — there's no multi-stop gradient editor anywhere in this codebase. */
  gradient: { from: string; to: string };
  style: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
  alignWithLayer: boolean;
  angle: number; // 0-360
  scale: number; // 10-150
}
export interface PatternOverlayStyleData {
  enabled: boolean;
  blendMode: BlendMode;
  opacity: number; // 0-100
  /** No pattern-asset library exists anywhere in this app — always null, the picker shows an
   *  honest "No patterns available" state (matches Color Lookup's own scope decision). */
  patternId: string | null;
  scale: number; // 1-1000
  linkWithLayer: boolean;
}
export interface StrokeStyleData {
  enabled: boolean;
  size: number; // 1-999
  position: 'outside' | 'inside' | 'center';
  blendMode: BlendMode;
  opacity: number; // 0-100
  fillType: 'color' | 'gradient' | 'pattern';
  color: string;
  gradient: { from: string; to: string };
}

/**
 * A layer's full Layer Style / Blending Options — `StudioLayer.effects` itself is optional (absent
 * = no dialog ever opened for this layer, matching the existing optional-field convention for
 * `mask`/`clipped`/`collapsed`), but once present every sub-style always exists with its own
 * `enabled` flag, rather than each sub-style itself being optional. This is a deliberate departure
 * from this file's usual "optional nested field" shape: Photoshop's own Layer Style dialog always
 * has settings for every effect type ready to go the instant you check its box, and modeling that
 * the same way here means the dialog never needs "construct defaults on first open" logic — opening
 * any style pane just reads what's already there.
 */
export type BlendIfChannel = 'gray' | 'r' | 'g' | 'b';
export interface BlendIfRange { blackMin: number; blackMax: number; whiteMin: number; whiteMax: number; }

export interface LayerEffects {
  advancedBlending: {
    fillOpacity: number; // 0-100
    channels: { r: boolean; g: boolean; b: boolean };
    knockout: 'none' | 'shallow' | 'deep';
    blendInteriorEffectsAsGroup: boolean;
    blendClippedLayersAsGroup: boolean;
    transparencyShapesLayer: boolean;
    layerMaskHidesEffects: boolean;
    vectorMaskHidesEffects: boolean;
  };
  /**
   * Blend If's two split-point ranges, This Layer and Underlying Layer, each black/white 0-255.
   * "This Layer" gates purely on this layer's own rendered luminance/alpha — real everywhere,
   * including the live Konva canvas (a per-node filter has everything it needs). "Underlying Layer"
   * needs the composited backdrop, which a Konva per-node filter fundamentally cannot see without
   * much deeper rendering-pipeline surgery than this feature warrants — real in flattened export
   * (`exportImage.ts`, which already composites sequentially with the backdrop naturally at hand)
   * but not live-previewed on screen; the Blending Options dialog says so next to the control.
   * `channel` selects the luminance source both ranges read (Gray by default, or a single R/G/B
   * byte), matching Photoshop's own single channel dropdown above both sliders.
   */
  blendIf: {
    channel: BlendIfChannel;
    thisLayer: BlendIfRange;
    underlying: BlendIfRange;
  };
  dropShadow: ShadowStyleData;
  innerShadow: ShadowStyleData;
  outerGlow: GlowStyleData;
  innerGlow: GlowStyleData;
  bevelEmboss: BevelEmbossData;
  satin: SatinStyleData;
  colorOverlay: SolidFillStyleData;
  gradientOverlay: GradientOverlayStyleData;
  patternOverlay: PatternOverlayStyleData;
  stroke: StrokeStyleData;
}

export function createDefaultLayerEffects(): LayerEffects {
  return {
    advancedBlending: {
      fillOpacity: 100,
      channels: { r: true, g: true, b: true },
      knockout: 'none',
      blendInteriorEffectsAsGroup: false,
      blendClippedLayersAsGroup: true,
      transparencyShapesLayer: true,
      layerMaskHidesEffects: false,
      vectorMaskHidesEffects: false,
    },
    blendIf: {
      channel: 'gray',
      thisLayer: { blackMin: 0, blackMax: 0, whiteMin: 255, whiteMax: 255 },
      underlying: { blackMin: 0, blackMax: 0, whiteMin: 255, whiteMax: 255 },
    },
    dropShadow: { enabled: false, blendMode: 'multiply', color: '#000000', opacity: 75, angle: 120, useGlobalLight: true, distance: 5, spread: 0, size: 5, noise: 0, layerKnocksOut: false },
    innerShadow: { enabled: false, blendMode: 'multiply', color: '#000000', opacity: 75, angle: 120, useGlobalLight: true, distance: 5, spread: 0, size: 5, noise: 0 },
    outerGlow: { enabled: false, blendMode: 'screen', color: '#ffff99', opacity: 75, noise: 0, technique: 'softer', spread: 0, size: 5, range: 50, jitter: 0 },
    innerGlow: { enabled: false, blendMode: 'screen', color: '#ffff99', opacity: 75, noise: 0, technique: 'softer', spread: 0, size: 5, range: 50, jitter: 0, source: 'edge' },
    bevelEmboss: { enabled: false, style: 'inner-bevel', technique: 'smooth', depth: 100, direction: 'up', size: 5, soften: 0, angle: 120, altitude: 30, highlightMode: 'screen', highlightColor: '#ffffff', highlightOpacity: 75, shadowMode: 'multiply', shadowColor: '#000000', shadowOpacity: 75, contourEnabled: false, textureEnabled: false },
    satin: { enabled: false, blendMode: 'multiply', color: '#000000', opacity: 50, angle: 19, distance: 11, size: 14, invert: true },
    colorOverlay: { enabled: false, blendMode: 'normal', color: '#ff0000', opacity: 100 },
    gradientOverlay: { enabled: false, blendMode: 'normal', opacity: 100, gradient: { from: '#000000', to: '#ffffff' }, style: 'linear', alignWithLayer: true, angle: 90, scale: 100 },
    patternOverlay: { enabled: false, blendMode: 'normal', opacity: 100, patternId: null, scale: 100, linkWithLayer: true },
    stroke: { enabled: false, size: 3, position: 'outside', blendMode: 'normal', opacity: 100, fillType: 'color', color: '#ff0000', gradient: { from: '#000000', to: '#ffffff' } },
  };
}

/** The 10 real (non-`advancedBlending`/`blendIf`) style keys, with display labels — shared by the
 *  Blending Options dialog's left nav and the Layers panel's expandable fx sub-rows, so the two
 *  never drift to different names for the same style. */
export type LayerStyleKey = 'dropShadow' | 'innerShadow' | 'outerGlow' | 'innerGlow' | 'bevelEmboss' | 'satin' | 'colorOverlay' | 'gradientOverlay' | 'patternOverlay' | 'stroke';
export const LAYER_STYLE_KEYS: LayerStyleKey[] = ['dropShadow', 'innerShadow', 'outerGlow', 'innerGlow', 'bevelEmboss', 'satin', 'colorOverlay', 'gradientOverlay', 'patternOverlay', 'stroke'];
export const LAYER_STYLE_LABEL: Record<LayerStyleKey, string> = {
  dropShadow: 'Drop Shadow', innerShadow: 'Inner Shadow', outerGlow: 'Outer Glow', innerGlow: 'Inner Glow',
  bevelEmboss: 'Bevel & Emboss', satin: 'Satin', colorOverlay: 'Color Overlay', gradientOverlay: 'Gradient Overlay',
  patternOverlay: 'Pattern Overlay', stroke: 'Stroke',
};

/** True if any style is actually switched on — gates the Layers panel's fx badge, which should only
 *  appear once something would actually render, not just because the dialog was opened once. */
export function hasAnyEnabledStyle(effects: LayerEffects): boolean {
  return effects.dropShadow.enabled || effects.innerShadow.enabled || effects.outerGlow.enabled
    || effects.innerGlow.enabled || effects.bevelEmboss.enabled || effects.satin.enabled
    || effects.colorOverlay.enabled || effects.gradientOverlay.enabled || effects.patternOverlay.enabled
    || effects.stroke.enabled;
}

/** Whether a single Blend If range departs from its no-op default (0/0/255/255, i.e. every pixel
 *  passes through unmasked). Deliberately separate from `hasAnyEnabledStyle` — Blend If has no
 *  `enabled` flag of its own, it's always structurally present and "on" once its split points move. */
export function isBlendIfRangeActive(range: BlendIfRange): boolean {
  return range.blackMin > 0 || range.blackMax > 0 || range.whiteMin < 255 || range.whiteMax < 255;
}

/** True if either side of Blend If is non-default — used for isolation/caching gates, which must
 *  stay in sync between the live canvas and `exportImage.ts` even though only `thisLayer` renders
 *  live (see the `blendIf` field's own doc comment above). */
export function hasActiveBlendIf(blendIf: LayerEffects['blendIf']): boolean {
  return isBlendIfRangeActive(blendIf.thisLayer) || isBlendIfRangeActive(blendIf.underlying);
}

export interface StudioLayer {
  id: string;
  type: StudioLayerType;
  name: string;
  visible: boolean;
  /** "Lock All" — the original single lock flag, unchanged in meaning (blocks paint, move, and
   *  delete together). The three granular locks below are independent additions on top of it, not
   *  a replacement — an old persisted layer with only `locked` set behaves exactly as it always
   *  did, since the new fields are optional and simply absent (falsy) on it. */
  locked: boolean;
  /** Painting only affects pixels that already have some opacity — new strokes get clipped to the
   *  layer's current alpha shape instead of extending it. */
  lockTransparentPixels?: boolean;
  /** No painting at all, full stop — distinct from `lockTransparentPixels`, which still allows
   *  painting over already-opaque pixels. */
  lockImagePixels?: boolean;
  /** The layer can't be dragged/transformed, but can still be painted on (unless one of the other
   *  two locks above also applies). */
  lockPosition?: boolean;
  opacity: number; // 0-1
  blendMode: BlendMode;
  /** Background layers can't be deleted, reordered below, or have opacity/blend changed. */
  isBackground?: boolean;
  /** Layer Style / Blending Options — absent means the dialog was never used for this layer. Any
   *  layer type may carry one (path layers included — unlike masks, nothing here needs a raster
   *  target to make sense). */
  effects?: LayerEffects;
  /**
   * Present iff type === 'group'. Bottom-to-top, same convention as the root array — `layerTree.ts`
   * owns that invariant, and nothing outside it may walk or edit this directly.
   */
  children?: StudioLayer[];
  /** Groups only: whether the panel shows the subtree. Persisted, as Photoshop does. */
  collapsed?: boolean;
  /** Clipped to the nearest non-clipped sibling below it in the same parent. */
  clipped?: boolean;
  /** Raster layer mask. Any layer type may carry one, groups included — except 'path', see PathLayerData. */
  mask?: LayerMask;
  /** Only present when type === 'text'. */
  text?: TextLayerData;
  /** Only present when type === 'adjustment'. */
  adjustment?: AdjustmentLayerData;
  /** Only present when type === 'path'. */
  path?: PathLayerData;
  /** Only present when type === 'placed-image'. */
  placedImage?: PlacedImageLayerData;
}

export function createBackgroundLayer(): StudioLayer {
  return {
    id: 'background',
    type: 'background',
    name: 'Background',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    isBackground: true,
  };
}

let layerCounter = 0;
export function createLayer(type: StudioLayerType, name: string): StudioLayer {
  layerCounter += 1;
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    type,
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
  };
}

export function createAdjustmentLayer(kind: AdjustmentKind = 'brightness-contrast'): StudioLayer {
  layerCounter += 1;
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    type: 'adjustment',
    name: ADJUSTMENT_KIND_LABEL[kind],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    adjustment: createDefaultAdjustmentData(kind),
  };
}

export function createGroupLayer(name = 'Group', children: StudioLayer[] = []): StudioLayer {
  layerCounter += 1;
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    type: 'group',
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    children,
    collapsed: false,
  };
}

/** Image > Place Image…: `x`/`y` are the *center* of the placed image (matches Konva's own
 *  offset-centered convention for draggable/rotatable nodes — rotation around a corner reads as
 *  orbiting instead of spinning in place, which center-anchoring avoids). */
export function createPlacedImageLayer(name: string, naturalWidth: number, naturalHeight: number, centerX: number, centerY: number, scale = 1): StudioLayer {
  layerCounter += 1;
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    type: 'placed-image',
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    placedImage: { naturalWidth, naturalHeight, x: centerX, y: centerY, scaleX: scale, scaleY: scale, rotation: 0 },
  };
}

export function createPathLayer(anchors: PathAnchor[], closed: boolean, style: { strokeColor: string; strokeWidth: number }): StudioLayer {
  layerCounter += 1;
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    type: 'path',
    name: `Path ${layerCounter}`,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    path: {
      anchors,
      closed,
      fill: { enabled: false, color: '#000000' },
      // Disabled by default — a new path is a working guide, not committed color. `color`/`width`
      // are just the starting values Stroke Path's dialog seeds itself from; nothing renders until
      // the user explicitly enables fill or runs Stroke Path/Fill Path. Was `enabled: true`, which
      // baked a visible stroke onto every path the instant it was drawn — a real, user-facing bug.
      stroke: { enabled: false, color: style.strokeColor, width: style.strokeWidth },
      fillRule: 'nonzero',
    },
  };
}

let maskCounter = 0;
export function createLayerMask(): LayerMask {
  maskCounter += 1;
  return { id: `mask-${Date.now()}-${maskCounter}`, enabled: true, linked: true };
}

/**
 * @param boxWidth When given, creates *box* (area) text of that width (click-drag);
 *                 omitted creates *point* text that grows with its content (click).
 * @param boxHeight When given alongside boxWidth, becomes the area frame's `fixedHeight` — the
 *                  exact Photoshop area-text convention: the rectangle you drag *is* the frame,
 *                  height included, not just a starting width that then auto-grows.
 */
export function createTextLayer(x: number, y: number, boxWidth?: number, boxHeight?: number): StudioLayer {
  layerCounter += 1;
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    type: 'text',
    name: `Text ${layerCounter}`,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    text: {
      content: '',
      x,
      y,
      width: boxWidth ?? 240,
      autoWidth: boxWidth === undefined,
      textMode: textModeFor(boxWidth === undefined),
      ...(boxWidth !== undefined && boxHeight !== undefined ? { fixedHeight: boxHeight } : {}),
      letterSpacing: 0,
      shadow: { ...DEFAULT_TEXT_SHADOW },
      gradient: { ...DEFAULT_TEXT_GRADIENT },
      // Empty content -> no runs; normalizeRuns keeps them in step as the content grows.
      runs: [],
      fontFamily: FONT_FAMILIES[0],
      fontSize: 28,
      color: '#000000',
      align: 'center',
      bold: false,
      italic: false,
      underline: false,
      lineHeight: 1.15,
      strokeColor: '#ffffff',
      strokeWidth: 0,
      rotation: 0,
      status: 'draft',
      comment: '',
    },
  };
}

/**
 * TypeR-style scripted lettering: a style is picked per script line by matching
 * a prefix (e.g. "!!" for SFX), then stripped before the text is placed.
 * Ported from the real TypeR 2.5 extension's parsing model (folders, "//"
 * continuation lines, Page-N auto page switching) — see CLAUDE.md for the
 * mapping of Photoshop-host concepts to this canvas app's equivalents.
 */
export interface TyperStyle {
  id: string;
  name: string;
  /** Which TyperFolder this style belongs to, or null/undefined if unsorted. Also drives
   *  prefix-matching priority — see parseTyperScript's `currentFolderId` option. */
  folderId?: string | null;
  /** Empty prefix ("") matches any line that no other, more specific style claims first. */
  prefix: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  strokeColor: string;
  strokeWidth: number;
  /** Eye-icon toggle: false means this style's prefix can never match a script line (it falls
   *  through to the next candidate) — the style still exists and can be re-enabled. Missing/undefined
   *  on data saved before this field existed is treated as enabled (see parseTyperScript's matchStyle). */
  enabled?: boolean;
}

/** A node in the TypeR style-folder tree. Nesting is expressed via `parentId`; `order` is the
 *  sibling sort key (mirrors `layerTree.ts`'s sibling-order convention for layer groups). */
export interface TyperFolder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
}

export const DEFAULT_TYPER_FOLDERS: TyperFolder[] = [
  { id: 'general', name: 'General', parentId: null, order: 0 },
];

export const DEFAULT_TYPER_STYLES: TyperStyle[] = [
  { id: 'dialogue', name: 'Dialogue', folderId: 'general', prefix: '', fontFamily: FONT_FAMILIES[0], fontSize: 26, color: '#000000', bold: false, italic: false, strokeColor: '#ffffff', strokeWidth: 0, enabled: true },
  { id: 'sfx', name: 'SFX', folderId: 'general', prefix: '!!', fontFamily: 'Impact', fontSize: 44, color: '#ffffff', bold: true, italic: false, strokeColor: '#000000', strokeWidth: 3, enabled: true },
  { id: 'thought', name: 'Thought', folderId: 'general', prefix: '~', fontFamily: FONT_FAMILIES[0], fontSize: 24, color: '#000000', bold: false, italic: true, strokeColor: '#ffffff', strokeWidth: 0, enabled: true },
];

export function createTyperStyle(name = 'New Style', folderId: string | null = null): TyperStyle {
  return { id: genTyperId(), name, folderId, prefix: '', fontFamily: FONT_FAMILIES[0], fontSize: 26, color: '#000000', bold: false, italic: false, strokeColor: '#ffffff', strokeWidth: 0, enabled: true };
}

let typerIdCounter = 0;
function genTyperId() {
  typerIdCounter += 1;
  return `style-${Date.now()}-${typerIdCounter}`;
}

let typerFolderIdCounter = 0;
function genTyperFolderId() {
  typerFolderIdCounter += 1;
  return `folder-${Date.now()}-${typerFolderIdCounter}`;
}

interface TyperFolderNode extends TyperFolder {
  children: TyperFolderNode[];
}

/** Nests folders by `parentId`, sorted by `order` at every level (recursive, mirrors editStyle.jsx's buildFolderTree). */
export function buildFolderTree(folders: TyperFolder[]): TyperFolderNode[] {
  const map = new Map<string, TyperFolderNode>();
  folders.forEach(f => map.set(f.id, { ...f, children: [] }));
  const roots: TyperFolderNode[] = [];
  map.forEach(node => {
    const parent = node.parentId ? map.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const sortRec = (nodes: TyperFolderNode[]) => {
    nodes.sort((a, b) => a.order - b.order);
    nodes.forEach(n => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export interface TyperFolderOption {
  id: string;
  depth: number;
  label: string;
}

/** Flattens a folder tree into an indented breadcrumb list, for a folder-picker `<select>`. */
export function flattenFolderTree(nodes: TyperFolderNode[], parents: string[] = [], depth = 0): TyperFolderOption[] {
  const list: TyperFolderOption[] = [];
  for (const node of nodes) {
    const breadcrumb = [...parents, node.name];
    list.push({ id: node.id, depth, label: breadcrumb.join(' / ') });
    list.push(...flattenFolderTree(node.children, breadcrumb, depth + 1));
  }
  return list;
}

function collectDescendantFolderIds(folders: TyperFolder[], folderId: string): string[] {
  const ids: string[] = [];
  const queue = [folderId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of folders.filter(f => f.parentId === current)) {
      ids.push(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

function isDescendantFolder(folders: TyperFolder[], ancestorId: string, targetId: string): boolean {
  let current = folders.find(f => f.id === targetId);
  while (current) {
    if (current.parentId === ancestorId) return true;
    current = current.parentId ? folders.find(f => f.id === current!.parentId) : undefined;
  }
  return false;
}

export function createTyperFolder(folders: TyperFolder[], name: string, parentId: string | null = null): TyperFolder {
  const siblings = folders.filter(f => f.parentId === parentId);
  return { id: genTyperFolderId(), name: name.trim() || 'New Folder', parentId, order: siblings.length };
}

/** Renames a folder. No-ops on an empty/whitespace-only name rather than leaving the folder unnamed. */
export function renameFolder(folders: TyperFolder[], folderId: string, name: string): TyperFolder[] {
  const trimmed = name.trim();
  if (!trimmed) return folders;
  return folders.map(f => (f.id === folderId ? { ...f, name: trimmed } : f));
}

/** Moves a folder under a new parent. No-ops on self-parenting or on a cycle (parenting a folder
 *  under its own descendant) — mirrors layerTree.ts's "illegal drag drop degrades to nothing
 *  happening" rule rather than corrupting the tree. */
export function reparentFolder(folders: TyperFolder[], folderId: string, newParentId: string | null): TyperFolder[] {
  if (folderId === newParentId) return folders;
  if (newParentId && isDescendantFolder(folders, folderId, newParentId)) return folders;
  const siblings = folders.filter(f => f.parentId === newParentId && f.id !== folderId);
  return folders.map(f => (f.id === folderId ? { ...f, parentId: newParentId, order: siblings.length } : f));
}

/** Deletes a folder and its descendants; styles inside any of them become unsorted rather than
 *  deleted (matches the real extension's default, non-permanent folder delete). */
export function deleteTyperFolder(folders: TyperFolder[], styles: TyperStyle[], folderId: string): { folders: TyperFolder[]; styles: TyperStyle[] } {
  const idsToRemove = new Set([folderId, ...collectDescendantFolderIds(folders, folderId)]);
  return {
    folders: folders.filter(f => !idsToRemove.has(f.id)),
    styles: styles.map(s => (s.folderId && idsToRemove.has(s.folderId) ? { ...s, folderId: null } : s)),
  };
}

export interface TyperLine {
  /** Raw source line(s) — multi-line when "//" continuation lines were merged in. */
  raw: string;
  content: string;
  style: TyperStyle;
  /** Set when a preceding "Page N" control line (English or Arabic, incl. Arabic-Indic digits) preceded this line. */
  pageHint?: string;
  /** Inline bold (markdown or HTML) wrapping on this line overrides the matched style for this placement only. */
  boldOverride?: boolean;
  italicOverride?: boolean;
}

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function arabicIndicToLatinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC_DIGITS.indexOf(d)));
}

/** Matches an English or Arabic "Page N" control line — case-insensitive, optional colon/dash, Arabic-Indic digits supported. */
const PAGE_LINE_RE = /^(?:page|الصفحة|ص)[\s:\-]*([0-9٠-٩]+)\s*$/i;

function stripInlineEmphasis(content: string): { content: string; boldOverride?: boolean; italicOverride?: boolean } {
  const boldMatch = content.match(/^\*\*(.+)\*\*$/) ?? content.match(/^<b>(.+)<\/b>$/i);
  if (boldMatch) return { content: boldMatch[1].trim(), boldOverride: true };
  const italicMatch = content.match(/^\*(.+)\*$/) ?? content.match(/^<i>(.+)<\/i>$/i);
  if (italicMatch) return { content: italicMatch[1].trim(), italicOverride: true };
  return { content };
}

export interface ParseTyperScriptOptions {
  /** The folder tree, used only to expand `currentFolderId` to include its descendant folders. */
  folders?: TyperFolder[];
  /** Line prefixes that mark a note/comment line to skip entirely. Defaults to `['##']`. */
  ignoreLinePrefixes?: string[];
  /** Substrings stripped from anywhere in a line's content (not just a prefix) before placement. */
  ignoreTags?: string[];
  /** Fallback style when no prefix matches, preferred over the empty-prefix-style convention. */
  defaultStyleId?: string | null;
  /** The folder whose styles get first crack at matching a line's prefix — mirrors the real
   *  extension's "current folder tag priority": the folder of the style just placed. */
  currentFolderId?: string | null;
}

/**
 * Parses a pasted script into placeable lines.
 * - Lines starting with a configured ignore-prefix (default `##`) are skipped (notes).
 * - Configured `ignoreTags` are stripped from anywhere in a line's content.
 * - "Page N" control lines (English/Arabic, Arabic-Indic digits ok) don't place text
 *   themselves — they tag the next real line with a `pageHint` for auto page-switching.
 * - "//" lines append to the previously placed line (a continuation), joined with a newline.
 * - Styles in `currentFolderId` (and its descendant folders) are tried first, longest-prefix-first;
 *   then all styles, longest-prefix-first; then `defaultStyleId`; then the empty-prefix style.
 * - A line fully wrapped in bold or italic markdown/HTML markers gets a per-placement style override.
 */
export function parseTyperScript(script: string, styles: TyperStyle[], options: ParseTyperScriptOptions = {}): TyperLine[] {
  const { folders = [], ignoreLinePrefixes = ['##'], ignoreTags = [], defaultStyleId = null, currentFolderId = null } = options;
  const isEnabled = (s: TyperStyle) => s.enabled !== false;
  const sortedStyles = [...styles].sort((a, b) => b.prefix.length - a.prefix.length);
  const priorityFolderIds = currentFolderId ? new Set([currentFolderId, ...collectDescendantFolderIds(folders, currentFolderId)]) : null;
  const folderStyles = priorityFolderIds ? sortedStyles.filter(s => s.folderId && priorityFolderIds.has(s.folderId)) : [];
  const defaultStyle = defaultStyleId ? styles.find(s => s.id === defaultStyleId) : undefined;

  // A disabled style (eye icon off) can never match by prefix — it falls through to the next
  // candidate — but it can still be reached via defaultStyleId/the empty-prefix fallback, matching
  // the request's "disabled styles cannot match [by prefix]" rather than removing them entirely.
  const matchStyle = (trimmed: string): TyperStyle =>
    folderStyles.find(s => s.prefix && isEnabled(s) && trimmed.startsWith(s.prefix))
      ?? sortedStyles.find(s => s.prefix && isEnabled(s) && trimmed.startsWith(s.prefix))
      ?? defaultStyle
      ?? sortedStyles.find(s => s.prefix === '')
      ?? styles[0];

  const lines: TyperLine[] = [];
  let pendingPageHint: string | undefined;

  for (const rawLine of script.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    if (ignoreLinePrefixes.some(p => p && trimmed.startsWith(p))) continue;

    const pageMatch = trimmed.match(PAGE_LINE_RE);
    if (pageMatch) {
      pendingPageHint = arabicIndicToLatinDigits(pageMatch[1]);
      continue;
    }

    if (trimmed.startsWith('//')) {
      const last = lines[lines.length - 1];
      if (last) {
        last.content = `${last.content}\n${trimmed.slice(2).trim()}`;
        last.raw = `${last.raw}\n${rawLine}`;
      }
      continue;
    }

    const style = matchStyle(trimmed);
    const stripped = style.prefix ? trimmed.slice(style.prefix.length).trim() : trimmed;
    const withoutTags = ignoreTags.reduce((acc, tag) => (tag ? acc.split(tag).join('') : acc), stripped);
    const { content, boldOverride, italicOverride } = stripInlineEmphasis(withoutTags);

    lines.push({ raw: rawLine, content, style, pageHint: pendingPageHint, boldOverride, italicOverride });
    pendingPageHint = undefined;
  }

  return lines;
}
