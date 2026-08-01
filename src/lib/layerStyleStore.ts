import { get, set } from 'idb-keyval';
import type { LayerEffects } from '../components/studio/studioTypes';

/** Named Layer Style presets ("New Style" in the Blending Options dialog) — same idb-keyval,
 *  load-on-mount/save-on-change shape as `paletteStore.ts`/`recentColorsStore.ts`. */
export interface LayerStylePreset {
  id: string;
  name: string;
  effects: LayerEffects;
}

const STORAGE_KEY = 'layer_style_presets';

export async function loadLayerStylePresets(): Promise<LayerStylePreset[]> {
  const saved = await get(STORAGE_KEY);
  return Array.isArray(saved) ? saved : [];
}

export async function saveLayerStylePresets(presets: LayerStylePreset[]): Promise<void> {
  await set(STORAGE_KEY, presets);
}
