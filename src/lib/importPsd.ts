import { readPsd } from 'ag-psd';
import type {
  Layer as PsdLayer, Psd, LayerEffectsInfo, Color, UnitsValue,
  TextStyle as PsdTextStyle, Justification as PsdJustification,
} from 'ag-psd';
import {
  createLayer, createGroupLayer, createTextLayer, createDefaultLayerEffects, BLEND_MODES,
  type StudioLayer, type BlendMode, type LayerEffects, type TextAlign, type TextRun,
} from '../components/studio/studioTypes';
import { normalizeRuns, type RunStylePatch } from '../components/studio/textRuns';

const VALID_BLEND_MODES = new Set<string>(BLEND_MODES.map((m) => m.id));

/** Inverse of `exportPsd.ts`'s `toPsdBlendMode` — ag-psd's own `BlendMode` union is the same 27
 *  modes as this app's, just space-separated ('color burn') instead of kebab-case ('color-burn').
 *  Falls back to 'normal' for the handful of PSD-only modes this app has no equivalent for
 *  ('pass through', 'linear height', 'height', 'subtraction') rather than importing garbage. */
function fromPsdBlendMode(mode: PsdLayer['blendMode'] | undefined): BlendMode {
  if (!mode) return 'normal';
  const kebab = mode.replace(/ /g, '-');
  return VALID_BLEND_MODES.has(kebab) ? (kebab as BlendMode) : 'normal';
}

/** Inverse of exportPsd.ts's `hexToRgb(...)` calls — ag-psd's `Color` is a union across several
 *  color spaces, but layer effects are always written as RGB by this app's own export path (and
 *  overwhelmingly so by Photoshop itself), so only that shape is handled; anything else falls back
 *  to black rather than guessing a conversion this app has no other use for. */
function psdColorToHex(color: Color | undefined): string | null {
  if (!color || !('r' in color) || !('g' in color) || !('b' in color)) return null;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[color.r, color.g, color.b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('')}`;
}

/** ag-psd's `Justification` has four `justify-*` variants this app's `TextAlign` has no finer
 *  equivalent for — all four collapse to `'justify'`. */
const JUSTIFICATION_TO_ALIGN: Record<PsdJustification, TextAlign> = {
  left: 'left',
  right: 'right',
  center: 'center',
  'justify-left': 'justify',
  'justify-right': 'justify',
  'justify-center': 'justify',
  'justify-all': 'justify',
};

/** Maps one ag-psd `TextStyle` (the layer's base style, or one `styleRuns[i].style`) onto this
 *  app's `RunStylePatch` — only setting fields the PSD style actually defines, so unset ones
 *  correctly fall back to the layer default via `resolveRunStyle`'s own run-then-layer precedence
 *  (textRuns.ts) instead of duplicating that precedence here. Reuses `psdColorToHex`, the same
 *  converter layer-effect colors already go through. */
function textStyleToRunPatch(style: PsdTextStyle | undefined): RunStylePatch {
  if (!style) return {};
  const patch: RunStylePatch = {};
  if (style.font?.name) patch.fontFamily = style.font.name;
  if (style.fontSize != null) patch.fontSize = style.fontSize;
  if (style.fauxBold != null) patch.bold = style.fauxBold;
  if (style.fauxItalic != null) patch.italic = style.fauxItalic;
  if (style.tracking != null) patch.letterSpacing = style.tracking;
  const color = psdColorToHex(style.fillColor);
  if (color) patch.color = color;
  return patch;
}

/**
 * Converts one PSD text layer into a real, editable `StudioLayer` (`type: 'text'`) instead of the
 * rasterized `clean-patch` every other layer gets — see `importLayer()`'s `psdLayer.text` branch.
 * Built on `createTextLayer()`, the same factory Studio itself uses, so every field this function
 * doesn't touch keeps that factory's normal defaults rather than being hand-assembled here.
 *
 * Only `left`/`top` are used for position — `transform`'s rotation/scale is deliberately not
 * decomposed: `exportPsd.ts` doesn't write text rotation either, so there's no round-trip to
 * preserve, and ordinary PSD text is essentially never transformed. `paragraphStyleRuns` (PSD's
 * per-character-range paragraph overrides) has no equivalent in this app's model either (which only
 * has one layer-level `align` plus per-wrapped-*line* `lineOverrides`, a different partitioning
 * scheme) — also not mapped, matching the fact `exportPsd.ts` doesn't write it.
 *
 * Returns `null` for the narrow case of a present-but-empty text shell; any other unexpected shape
 * is left to throw, which the caller catches and falls back to the raster path for.
 */
export function mapPsdTextLayer(psdLayer: PsdLayer): StudioLayer | null {
  const data = psdLayer.text;
  if (!data || typeof data.text !== 'string') return null;

  const content = data.text.replace(/\r\n?/g, '\n');
  const x = data.left ?? psdLayer.left ?? 0;
  const y = data.top ?? psdLayer.top ?? 0;

  const { left, top, right, bottom } = data;
  const layer =
    data.shapeType === 'box'
    && typeof left === 'number' && typeof top === 'number'
    && typeof right === 'number' && typeof bottom === 'number'
    && Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(right) && Number.isFinite(bottom)
    && (right - left) > 0 && (bottom - top) > 0
      ? createTextLayer(x, y, right - left, bottom - top)
      : createTextLayer(x, y);

  const text = layer.text!;
  const base = textStyleToRunPatch(data.style);
  if (base.fontFamily != null) text.fontFamily = base.fontFamily;
  if (base.fontSize != null) text.fontSize = base.fontSize;
  if (base.bold != null) text.bold = base.bold;
  if (base.italic != null) text.italic = base.italic;
  if (base.letterSpacing != null) text.letterSpacing = base.letterSpacing;
  if (base.color != null) text.color = base.color;

  // ag-psd stores absolute leading (px); this app stores a lineHeight multiplier. Auto-leading (no
  // explicit value, Photoshop's default) keeps the factory default rather than dividing by nothing.
  if (data.style?.leading != null && data.style.autoLeading !== true && text.fontSize > 0) {
    text.lineHeight = data.style.leading / text.fontSize;
  }

  const justification = data.paragraphStyle?.justification;
  if (justification) text.align = JUSTIFICATION_TO_ALIGN[justification];

  text.content = content;
  const rawRuns: TextRun[] = (data.styleRuns ?? []).map((run) => ({
    length: run.length,
    ...textStyleToRunPatch(run.style),
  }));
  text.runs = rawRuns.length > 0 ? normalizeRuns(content, rawRuns) : [];

  layer.name = psdLayer.name || 'Layer';
  layer.visible = !psdLayer.hidden;
  layer.opacity = psdLayer.opacity ?? 1;
  layer.blendMode = fromPsdBlendMode(psdLayer.blendMode);
  layer.effects = mapPsdEffects(psdLayer.effects);

  return layer;
}

/** Inverse of exportPsd.ts's `px(...)` — that helper always writes `{ units: 'Pixels', value }`, so
 *  reading `.value` back directly (rounded) round-trips exactly for anything this app itself wrote;
 *  a PSD from Photoshop in a non-pixel unit reads as that same numeric value, which is an accepted
 *  approximation rather than a full unit-conversion system this app has no other need for. */
function unitsToPx(v: UnitsValue | undefined, fallback: number): number {
  return v ? Math.round(v.value) : fallback;
}

/** Inverse of exportPsd.ts's `pct(...)` (`value / 100`) — ag-psd's effect opacity/noise/etc. fields
 *  are 0-1, this app's are 0-100. */
function fromPct(v: number | undefined, fallback: number): number {
  return v === undefined ? fallback : Math.round(v * 100);
}

/**
 * Maps ag-psd's per-layer effects (`Layer.effects`, Photoshop's own Layer Style data) onto this
 * app's `LayerEffects` shape, so a PSD's Drop Shadow/Stroke/Glow/etc. survive the round trip and
 * open already-configured in the Blending Options dialog — mirrors `exportPsd.ts`'s `psdEffects()`
 * exactly in reverse (same field names, same px/pct/color conventions), so the two can't drift.
 * PSD supports multiple stacked instances of some effect kinds (`dropShadow`/`stroke`/etc. are
 * arrays); this app's dialog only ever models one of each, matching Photoshop's own Layer Style UI,
 * so only the first instance of each array is imported. Returns undefined when the layer has no
 * effects at all, matching `StudioLayer.effects`'s existing "absent = dialog never opened" contract.
 */
export function mapPsdEffects(info: LayerEffectsInfo | undefined): LayerEffects | undefined {
  if (!info) return undefined;
  const effects = createDefaultLayerEffects();

  const ds = info.dropShadow?.[0];
  if (ds) {
    effects.dropShadow = {
      ...effects.dropShadow, enabled: ds.enabled ?? true, blendMode: fromPsdBlendMode(ds.blendMode),
      color: psdColorToHex(ds.color) ?? effects.dropShadow.color, opacity: fromPct(ds.opacity, effects.dropShadow.opacity),
      angle: ds.angle ?? effects.dropShadow.angle, useGlobalLight: ds.useGlobalLight ?? effects.dropShadow.useGlobalLight,
      distance: unitsToPx(ds.distance, effects.dropShadow.distance), spread: unitsToPx(ds.choke, effects.dropShadow.spread),
      size: unitsToPx(ds.size, effects.dropShadow.size), layerKnocksOut: ds.layerConceals,
    };
  }
  const is = info.innerShadow?.[0];
  if (is) {
    effects.innerShadow = {
      ...effects.innerShadow, enabled: is.enabled ?? true, blendMode: fromPsdBlendMode(is.blendMode),
      color: psdColorToHex(is.color) ?? effects.innerShadow.color, opacity: fromPct(is.opacity, effects.innerShadow.opacity),
      angle: is.angle ?? effects.innerShadow.angle, useGlobalLight: is.useGlobalLight ?? effects.innerShadow.useGlobalLight,
      distance: unitsToPx(is.distance, effects.innerShadow.distance), spread: unitsToPx(is.choke, effects.innerShadow.spread),
      size: unitsToPx(is.size, effects.innerShadow.size),
    };
  }
  const og = info.outerGlow;
  if (og) {
    effects.outerGlow = {
      ...effects.outerGlow, enabled: og.enabled ?? true, blendMode: fromPsdBlendMode(og.blendMode),
      color: psdColorToHex(og.color) ?? effects.outerGlow.color, opacity: fromPct(og.opacity, effects.outerGlow.opacity),
      noise: fromPct(og.noise, effects.outerGlow.noise), range: fromPct(og.range, effects.outerGlow.range),
      jitter: fromPct(og.jitter, effects.outerGlow.jitter), spread: unitsToPx(og.choke, effects.outerGlow.spread),
      size: unitsToPx(og.size, effects.outerGlow.size),
    };
  }
  const ig = info.innerGlow;
  if (ig) {
    effects.innerGlow = {
      ...effects.innerGlow, enabled: ig.enabled ?? true, blendMode: fromPsdBlendMode(ig.blendMode),
      color: psdColorToHex(ig.color) ?? effects.innerGlow.color, opacity: fromPct(ig.opacity, effects.innerGlow.opacity),
      noise: fromPct(ig.noise, effects.innerGlow.noise), range: fromPct(ig.range, effects.innerGlow.range),
      jitter: fromPct(ig.jitter, effects.innerGlow.jitter), technique: ig.technique ?? effects.innerGlow.technique,
      source: ig.source ?? effects.innerGlow.source, spread: unitsToPx(ig.choke, effects.innerGlow.spread),
      size: unitsToPx(ig.size, effects.innerGlow.size),
    };
  }
  const b = info.bevel;
  if (b) {
    effects.bevelEmboss = {
      ...effects.bevelEmboss, enabled: b.enabled ?? true,
      style: (b.style?.replace(/ /g, '-') as LayerEffects['bevelEmboss']['style']) ?? effects.bevelEmboss.style,
      technique: (b.technique?.replace(/ /g, '-') as LayerEffects['bevelEmboss']['technique']) ?? effects.bevelEmboss.technique,
      direction: b.direction ?? effects.bevelEmboss.direction,
      size: unitsToPx(b.size, effects.bevelEmboss.size), soften: unitsToPx(b.soften, effects.bevelEmboss.soften),
      depth: fromPct(b.strength, effects.bevelEmboss.depth), angle: b.angle ?? effects.bevelEmboss.angle,
      altitude: b.altitude ?? effects.bevelEmboss.altitude,
      highlightMode: fromPsdBlendMode(b.highlightBlendMode), highlightColor: psdColorToHex(b.highlightColor) ?? effects.bevelEmboss.highlightColor,
      highlightOpacity: fromPct(b.highlightOpacity, effects.bevelEmboss.highlightOpacity),
      shadowMode: fromPsdBlendMode(b.shadowBlendMode), shadowColor: psdColorToHex(b.shadowColor) ?? effects.bevelEmboss.shadowColor,
      shadowOpacity: fromPct(b.shadowOpacity, effects.bevelEmboss.shadowOpacity),
    };
  }
  const satin = info.satin;
  if (satin) {
    effects.satin = {
      ...effects.satin, enabled: satin.enabled ?? true, blendMode: fromPsdBlendMode(satin.blendMode),
      color: psdColorToHex(satin.color) ?? effects.satin.color, opacity: fromPct(satin.opacity, effects.satin.opacity),
      distance: unitsToPx(satin.distance, effects.satin.distance), size: unitsToPx(satin.size, effects.satin.size),
      angle: satin.angle ?? effects.satin.angle, invert: satin.invert ?? effects.satin.invert,
    };
  }
  const fill = info.solidFill?.[0];
  if (fill) {
    effects.colorOverlay = {
      ...effects.colorOverlay, enabled: fill.enabled ?? true, blendMode: fromPsdBlendMode(fill.blendMode),
      color: psdColorToHex(fill.color) ?? effects.colorOverlay.color, opacity: fromPct(fill.opacity, effects.colorOverlay.opacity),
    };
  }
  const grad = info.gradientOverlay?.[0];
  if (grad) {
    const stops = grad.gradient && grad.gradient.type === 'solid' ? grad.gradient.colorStops : undefined;
    effects.gradientOverlay = {
      ...effects.gradientOverlay, enabled: grad.enabled ?? true, blendMode: fromPsdBlendMode(grad.blendMode as PsdLayer['blendMode']),
      opacity: fromPct(grad.opacity, effects.gradientOverlay.opacity),
      gradient: stops && stops.length >= 2
        ? { from: psdColorToHex(stops[0].color) ?? effects.gradientOverlay.gradient.from, to: psdColorToHex(stops[stops.length - 1].color) ?? effects.gradientOverlay.gradient.to }
        : effects.gradientOverlay.gradient,
      style: grad.type ?? effects.gradientOverlay.style, alignWithLayer: grad.align ?? effects.gradientOverlay.alignWithLayer,
      angle: grad.angle ?? effects.gradientOverlay.angle, scale: fromPct(grad.scale !== undefined ? grad.scale / 100 : undefined, effects.gradientOverlay.scale),
    };
  }
  // Pattern Overlay: this app has no pattern-asset library (see PatternOverlayStyleData's own doc
  // comment) — a PSD's pattern reference can't be resolved to anything real, so it's deliberately
  // left disabled rather than importing a pattern picker entry that points at nothing.
  const stroke = info.stroke?.[0];
  if (stroke) {
    effects.stroke = {
      ...effects.stroke, enabled: stroke.enabled ?? true, size: unitsToPx(stroke.size, effects.stroke.size),
      position: stroke.position ?? effects.stroke.position, blendMode: fromPsdBlendMode(stroke.blendMode),
      opacity: fromPct(stroke.opacity, effects.stroke.opacity), fillType: stroke.fillType ?? effects.stroke.fillType,
      color: psdColorToHex(stroke.color) ?? effects.stroke.color,
    };
  }

  return effects;
}

/** ag-psd sizes a layer's own `canvas` to its bounding box (`right-left` x `bottom-top`), not the
 *  full document — the caller must draw it at `(left, top)` onto a page-sized canvas, not (0, 0). */
export interface ParsedPsdRaster {
  canvas: HTMLCanvasElement;
  left: number;
  top: number;
}

export interface ParsedPsd {
  width: number;
  height: number;
  /** Bottom-to-top, matching this app's own layer array convention (PSD stores top-to-bottom). */
  layers: StudioLayer[];
  /** Per-layer pixel content, keyed by the new `StudioLayer.id` — caller draws these into its own
   *  raster canvas registry (this module has no knowledge of that registry). */
  rasters: Map<string, ParsedPsdRaster>;
}

/**
 * Reads a `.psd` file and converts it into this app's own layer tree, for File > Open/Place PSD.
 *
 * A PSD layer with text data imports as a real, editable `'text'`-type layer (see
 * `mapPsdTextLayer`). Every other non-group layer (adjustment, shape, smart object, ordinary pixel
 * layer) still imports as a flattened raster `clean-patch` layer using ag-psd's own pre-composited
 * per-layer canvas (`readPsd`'s default behavior) — reconstructing those from PSD's proprietary,
 * feature-specific data would be a much larger, much less reliable undertaking than text was, and
 * this app already treats "real pixels now" as the honest scope for those (same reasoning as
 * Bevel & Emboss's overlay-only simplification). Groups become real `group`-type layers with their
 * children imported recursively, so grouping structure survives the round trip regardless.
 */
export async function parsePsdFile(file: File): Promise<ParsedPsd> {
  const buffer = await file.arrayBuffer();
  const psd: Psd = readPsd(buffer, { skipThumbnail: true });

  const rasters = new Map<string, ParsedPsdRaster>();

  function importLayer(psdLayer: PsdLayer): StudioLayer {
    if (psdLayer.children) {
      // PSD stores top-to-bottom; this app's arrays are bottom-to-top.
      const children = [...psdLayer.children].reverse().map(importLayer);
      const group = createGroupLayer(psdLayer.name || 'Group', children);
      group.visible = !psdLayer.hidden;
      group.opacity = psdLayer.opacity ?? 1;
      group.blendMode = fromPsdBlendMode(psdLayer.blendMode);
      group.effects = mapPsdEffects(psdLayer.effects);
      return group;
    }

    if (psdLayer.text) {
      try {
        const textLayer = mapPsdTextLayer(psdLayer);
        if (textLayer) return textLayer;
      } catch {
        // Malformed/unexpected text data — fall through to the raster path below rather than
        // dropping the layer or aborting the whole import; ag-psd still produces a composited
        // `psdLayer.canvas` for text layers regardless, so it's always a valid fallback input.
      }
    }

    const layer = createLayer('clean-patch', psdLayer.name || 'Layer');
    layer.visible = !psdLayer.hidden;
    layer.opacity = psdLayer.opacity ?? 1;
    layer.blendMode = fromPsdBlendMode(psdLayer.blendMode);
    layer.effects = mapPsdEffects(psdLayer.effects);
    if (psdLayer.canvas) rasters.set(layer.id, { canvas: psdLayer.canvas, left: psdLayer.left ?? 0, top: psdLayer.top ?? 0 });
    return layer;
  }

  if (psd.children && psd.children.length > 0) {
    const layers = [...psd.children].reverse().map(importLayer);
    return { width: psd.width, height: psd.height, layers, rasters };
  }

  // Flattened single-canvas PSD — one raster layer holding the whole composite. Not the special
  // `isBackground` layer: the point of importing is that it's immediately editable.
  const layer = createLayer('clean-patch', 'Background');
  if (psd.canvas) rasters.set(layer.id, { canvas: psd.canvas, left: 0, top: 0 });
  return { width: psd.width, height: psd.height, layers: [layer], rasters };
}
