import { readPsd } from 'ag-psd';
import type { Layer as PsdLayer, Psd } from 'ag-psd';
import { createLayer, createGroupLayer, BLEND_MODES, type StudioLayer, type BlendMode } from '../components/studio/studioTypes';

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
 * Every PSD layer (including text) imports as a flattened raster `clean-patch` layer using
 * ag-psd's own pre-composited per-layer canvas (`readPsd`'s default behavior) — reconstructing an
 * editable text/adjustment layer from PSD's proprietary text-engine data would be a much larger,
 * much less reliable undertaking, and this app already treats "real pixels now" as the honest
 * scope for a first cut (same reasoning as Bevel & Emboss's overlay-only simplification). Groups
 * become real `group`-type layers with their children imported recursively, so grouping structure
 * still survives the round trip even though text doesn't stay editable.
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
      return group;
    }

    const layer = createLayer('clean-patch', psdLayer.name || 'Layer');
    layer.visible = !psdLayer.hidden;
    layer.opacity = psdLayer.opacity ?? 1;
    layer.blendMode = fromPsdBlendMode(psdLayer.blendMode);
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
