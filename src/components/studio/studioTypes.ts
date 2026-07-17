import type { LucideIcon } from 'lucide-react';
import { Image as ImageIcon, Type, Eraser, SlidersHorizontal, Folder } from 'lucide-react';

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' },
];

/** Maps our blend mode ids to Konva's globalCompositeOperation values. */
export const BLEND_TO_COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
};

export type StudioLayerType = 'background' | 'clean-patch' | 'text' | 'adjustment' | 'group';

/** How a click changes the canvas selection: plain click replaces it, Shift/Ctrl-click toggles. */
export type LayerSelectMode = 'replace' | 'toggle';

export const LAYER_TYPE_ICON: Record<StudioLayerType, LucideIcon> = {
  background: ImageIcon,
  'clean-patch': Eraser,
  text: Type,
  adjustment: SlidersHorizontal,
  group: Folder,
};

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

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
  /** Extra px between characters (Konva `letterSpacing`; canvas 2D letterSpacing on export). */
  letterSpacing: number;
  /** Drop shadow / glow — a glow is just a shadow at offset 0 with a wide blur. */
  shadow: TextShadow;
  /** Gradient fill; overrides `color` while enabled. */
  gradient: TextGradient;
  /** Per-character overrides over the layer style above. See TextRun; maintained by textRuns.ts. */
  runs: TextRun[];
  /** Translator workflow metadata — surfaced in the Translation Preview panel. */
  status: TranslationStatus;
  comment: string;
}

export const DEFAULT_TEXT_SHADOW: TextShadow = {
  enabled: false, color: '#000000', blur: 6, offsetX: 0, offsetY: 2,
};

export const DEFAULT_TEXT_GRADIENT: TextGradient = {
  enabled: false, from: '#ffffff', to: '#000000', angle: 90,
};

export type AdjustmentKind = 'brightness-contrast' | 'hue-saturation' | 'levels';

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
 */
export interface AdjustmentLayerData {
  kind: AdjustmentKind;
  /** -100..100 */
  brightness: number;
  /** -100..100 */
  contrast: number;
  /** -180..180 degrees */
  hue: number;
  /** -100..100 */
  saturation: number;
  /** -100..100 */
  lightness: number;
  levels: {
    inBlack: number; // 0-255
    inWhite: number; // 0-255
    gamma: number; // 0.1-9.99
    outBlack: number; // 0-255
    outWhite: number; // 0-255
  };
}

export function createDefaultAdjustmentData(kind: AdjustmentKind = 'brightness-contrast'): AdjustmentLayerData {
  return {
    kind,
    brightness: 0,
    contrast: 0,
    hue: 0,
    saturation: 0,
    lightness: 0,
    levels: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
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

export interface StudioLayer {
  id: string;
  type: StudioLayerType;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0-1
  blendMode: BlendMode;
  /** Background layers can't be deleted, reordered below, or have opacity/blend changed. */
  isBackground?: boolean;
  /**
   * Present iff type === 'group'. Bottom-to-top, same convention as the root array — `layerTree.ts`
   * owns that invariant, and nothing outside it may walk or edit this directly.
   */
  children?: StudioLayer[];
  /** Groups only: whether the panel shows the subtree. Persisted, as Photoshop does. */
  collapsed?: boolean;
  /** Clipped to the nearest non-clipped sibling below it in the same parent. */
  clipped?: boolean;
  /** Raster layer mask. Any layer type may carry one, groups included. */
  mask?: LayerMask;
  /** Only present when type === 'text'. */
  text?: TextLayerData;
  /** Only present when type === 'adjustment'. */
  adjustment?: AdjustmentLayerData;
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
  const label = kind === 'brightness-contrast' ? 'Brightness/Contrast' : kind === 'hue-saturation' ? 'Hue/Saturation' : 'Levels';
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    type: 'adjustment',
    name: label,
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

let maskCounter = 0;
export function createLayerMask(): LayerMask {
  maskCounter += 1;
  return { id: `mask-${Date.now()}-${maskCounter}`, enabled: true, linked: true };
}

/**
 * @param boxWidth When given, creates *box* text of that width (click-drag);
 *                 omitted creates *point* text that grows with its content (click).
 */
export function createTextLayer(x: number, y: number, boxWidth?: number): StudioLayer {
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
  /** Purely organizational (grouping in the panel) — folder membership does not itself affect prefix matching priority; see parseTyperScript. */
  folder?: string;
  /** Empty prefix ("") matches any line that no other, more specific style claims first. */
  prefix: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  strokeColor: string;
  strokeWidth: number;
}

export const DEFAULT_TYPER_STYLES: TyperStyle[] = [
  { id: 'dialogue', name: 'Dialogue', folder: 'General', prefix: '', fontFamily: FONT_FAMILIES[0], fontSize: 26, color: '#000000', bold: false, italic: false, strokeColor: '#ffffff', strokeWidth: 0 },
  { id: 'sfx', name: 'SFX', folder: 'General', prefix: '!!', fontFamily: 'Impact', fontSize: 44, color: '#ffffff', bold: true, italic: false, strokeColor: '#000000', strokeWidth: 3 },
  { id: 'thought', name: 'Thought', folder: 'General', prefix: '~', fontFamily: FONT_FAMILIES[0], fontSize: 24, color: '#000000', bold: false, italic: true, strokeColor: '#ffffff', strokeWidth: 0 },
];

export function createTyperStyle(name = 'New Style'): TyperStyle {
  return { id: genTyperId(), name, folder: 'General', prefix: '', fontFamily: FONT_FAMILIES[0], fontSize: 26, color: '#000000', bold: false, italic: false, strokeColor: '#ffffff', strokeWidth: 0 };
}

let typerIdCounter = 0;
function genTyperId() {
  typerIdCounter += 1;
  return `style-${Date.now()}-${typerIdCounter}`;
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

/**
 * Parses a pasted script into placeable lines.
 * - "##" prefix lines are ignored (notes).
 * - "Page N" control lines (English/Arabic, Arabic-Indic digits ok) don't place text
 *   themselves — they tag the next real line with a `pageHint` for auto page-switching.
 * - "//" lines append to the previously placed line (a continuation), joined with a newline.
 * - Longer prefixes are checked first so "!!" doesn't get shadowed by an empty-prefix style.
 * - A line fully wrapped in bold or italic markdown/HTML markers gets a per-placement style override.
 */
export function parseTyperScript(script: string, styles: TyperStyle[]): TyperLine[] {
  const sortedStyles = [...styles].sort((a, b) => b.prefix.length - a.prefix.length);
  const lines: TyperLine[] = [];
  let pendingPageHint: string | undefined;

  for (const rawLine of script.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('##')) continue;

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

    const style = sortedStyles.find(s => s.prefix && trimmed.startsWith(s.prefix))
      ?? sortedStyles.find(s => s.prefix === '')
      ?? styles[0];
    const stripped = style.prefix ? trimmed.slice(style.prefix.length).trim() : trimmed;
    const { content, boldOverride, italicOverride } = stripInlineEmphasis(stripped);

    lines.push({ raw: rawLine, content, style, pageHint: pendingPageHint, boldOverride, italicOverride });
    pendingPageHint = undefined;
  }

  return lines;
}
