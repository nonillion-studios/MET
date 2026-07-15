import { get, set } from 'idb-keyval';
import type { BrushShape } from '../components/studio/paint/brushTip';

/**
 * A saved brush: every engine parameter from PaintSettings that describes the
 * *brush* (not the document or the colour), plus panel metadata.
 *
 * `shape: 'image'` brushes carry `tipMaskDataUrl` — a pre-baked alpha mask (see
 * imageToBrushMask). Storing the mask rather than the original upload means tip
 * generation never has to re-derive alpha from luminance per stamp.
 */
export interface BrushPreset {
  id: string;
  name: string;
  folder: string;
  favorite: boolean;
  /** Built-ins ship with the app: they can be favourited/duplicated but not renamed or deleted. */
  builtin?: boolean;

  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
  angle: number;
  roundness: number;
  scatter: number;
  smoothing: number;
  pressureSize: boolean;
  pressureOpacity: boolean;

  shape: BrushShape | 'image';
  /** Only for shape==='image'. PNG data URL whose alpha channel is the tip mask. */
  tipMaskDataUrl?: string;
}

export const BRUSH_FOLDERS = ['Basic', 'Soft', 'Hard', 'Ink', 'Manga', 'Texture', 'Imported'] as const;

const STORAGE_KEY = 'brush_presets';
const SCHEMA_KEY = 'brush_presets_schema';
const SCHEMA_VERSION = 1;

function preset(p: Partial<BrushPreset> & { id: string; name: string; folder: string }): BrushPreset {
  return {
    favorite: false,
    builtin: true,
    size: 24,
    hardness: 0.8,
    opacity: 1,
    flow: 1,
    spacing: 0.15,
    angle: 0,
    roundness: 1,
    scatter: 0,
    smoothing: 0,
    pressureSize: true,
    pressureOpacity: false,
    shape: 'round',
    ...p,
  };
}

/**
 * Built-in presets. These are just parameter combinations over the same engine —
 * deliberately not a separate "brush type" concept, so an imported or duplicated
 * brush is exactly as capable as a shipped one.
 */
export const BUILTIN_BRUSHES: BrushPreset[] = [
  preset({ id: 'b-round', name: 'Hard Round', folder: 'Basic', hardness: 1, spacing: 0.1 }),
  preset({ id: 'b-soft', name: 'Soft Round', folder: 'Soft', hardness: 0.25, spacing: 0.08, size: 40 }),
  preset({ id: 'b-airbrush', name: 'Airbrush', folder: 'Soft', hardness: 0.05, flow: 0.25, spacing: 0.04, size: 60 }),
  preset({ id: 'b-hard-edge', name: 'Hard Edge', folder: 'Hard', hardness: 1, spacing: 0.05, size: 16 }),
  preset({ id: 'b-square', name: 'Square', folder: 'Hard', shape: 'square', hardness: 1, spacing: 0.1 }),
  // Manga inking: hard, tight spacing, pressure-driven size — the taper is the point.
  preset({ id: 'b-inker', name: 'G-Pen Inker', folder: 'Ink', hardness: 1, spacing: 0.03, size: 12, pressureSize: true }),
  preset({ id: 'b-maru', name: 'Maru Pen', folder: 'Ink', hardness: 1, spacing: 0.03, size: 6, pressureSize: true }),
  preset({ id: 'b-calligraphy', name: 'Calligraphy', folder: 'Ink', hardness: 1, spacing: 0.04, size: 28, roundness: 0.25, angle: 45 }),
  preset({ id: 'b-screentone', name: 'Screentone Dot', folder: 'Manga', hardness: 1, spacing: 0.9, size: 8 }),
  preset({ id: 'b-hatch', name: 'Hatching', folder: 'Manga', hardness: 1, spacing: 0.5, size: 10, roundness: 0.15, angle: -45 }),
  preset({ id: 'b-chalk', name: 'Chalk', folder: 'Texture', hardness: 0.6, spacing: 0.12, scatter: 0.35, size: 30 }),
  preset({ id: 'b-spatter', name: 'Spatter', folder: 'Texture', hardness: 0.9, spacing: 0.6, scatter: 0.9, size: 18 }),
];

export async function loadBrushPresets(): Promise<BrushPreset[]> {
  const [saved, version] = await Promise.all([get(STORAGE_KEY), get(SCHEMA_KEY)]);
  if (!Array.isArray(saved)) return [...BUILTIN_BRUSHES];
  // Forward-compat: an unknown/newer schema is left alone rather than silently
  // coerced; an older one would migrate here (see migrate.ts for the pattern).
  if (version !== SCHEMA_VERSION) return [...BUILTIN_BRUSHES, ...saved.filter((b: BrushPreset) => !b.builtin)];
  // Built-ins always come from code, so shipping a new one doesn't require a migration.
  const custom = saved.filter((b: BrushPreset) => !b.builtin);
  const savedById = new Map(saved.map((b: BrushPreset) => [b.id, b]));
  const builtins = BUILTIN_BRUSHES.map(b => {
    const prev = savedById.get(b.id);
    return prev ? { ...b, favorite: prev.favorite } : b;
  });
  return [...builtins, ...custom];
}

export async function saveBrushPresets(presets: BrushPreset[]): Promise<void> {
  await set(STORAGE_KEY, presets);
  await set(SCHEMA_KEY, SCHEMA_VERSION);
}
