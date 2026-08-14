import { get, set } from 'idb-keyval';
import { genId } from './id';
import { DEFAULT_TEXT_SHADOW, DEFAULT_TEXT_GRADIENT, createDefaultAdjustmentData, type StudioLayer, type TyperStyle, type TyperFolder } from '../components/studio/studioTypes';

/** Bump + add a migration step in loadChapterStudioData whenever the persisted shape changes.
 *  v7 added the 'path' layer type — no backfill needed (old data simply has zero path layers).
 *  v8 added 8 new AdjustmentKind values plus per-channel Curves/Hue-Saturation/Levels — every new
 *  AdjustmentLayerData field backfills from createDefaultAdjustmentData(a.kind), see migrateLayer.
 *  v9 added StudioLayer.effects (Blending Options) — optional, and absent is precisely the pre-v9
 *  behaviour (no styles applied), the same reasoning v5's `mask`/`clipped`/`collapsed` already used.
 *  No backfill of its own.
 *  `effects.blendIf.channel` was added later within v9 (Gray/R/G/B selector) — no version bump per
 *  this file's own "new field is one more `??`" rule below, backfilled to 'gray' in migrateLayer. */
export const STUDIO_SCHEMA_VERSION = 9;
const SCHEMA_VERSION = STUDIO_SCHEMA_VERSION;
const MAX_VERSIONS = 10;

/**
 * A StudioLayer plus its pixel content: `raster` for the layer's own pixels ('clean-patch'), and
 * `maskRaster` for its layer mask. `children` recurses, so a group nests in the JSON exactly as it
 * does in memory.
 */
export type SerializedStudioLayer = Omit<StudioLayer, 'children'> & {
  raster?: string;
  maskRaster?: string;
  children?: SerializedStudioLayer[];
};

export interface ChapterStudioData {
  schemaVersion: typeof SCHEMA_VERSION;
  layersByPage: Record<string, SerializedStudioLayer[]>;
  typerScript: string;
  typerStyles: TyperStyle[];
  typerFolders: TyperFolder[];
  ignoreLinePrefixes: string[];
  ignoreTags: string[];
  defaultStyleId: string | null;
  updatedAt: string;
}

export interface StudioVersionSnapshot {
  id: string;
  timestamp: string;
  label?: string;
  data: ChapterStudioData;
}

function studioKey(chapterId: string) {
  return `studio_${chapterId}`;
}

function versionsKey(chapterId: string) {
  return `studio_versions_${chapterId}`;
}

export function createEmptyStudioData(): ChapterStudioData {
  return {
    schemaVersion: SCHEMA_VERSION,
    layersByPage: {},
    typerScript: '',
    typerStyles: [],
    typerFolders: [],
    ignoreLinePrefixes: ['##'],
    ignoreTags: [],
    defaultStyleId: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Backfills one layer. Recurses into groups; on pre-v5 data no layer has children, so it bottoms
 *  out immediately and this is exactly the old flat `.map`. */
function migrateLayer(l: SerializedStudioLayer): SerializedStudioLayer {
  let migrated: SerializedStudioLayer = l;

  if (l.type === 'text' && l.text) {
    migrated = {
      ...migrated,
      text: {
        ...l.text,
        autoWidth: l.text.autoWidth ?? false,
        letterSpacing: l.text.letterSpacing ?? 0,
        shadow: l.text.shadow ?? { ...DEFAULT_TEXT_SHADOW },
        gradient: l.text.gradient ?? { ...DEFAULT_TEXT_GRADIENT },
        runs: l.text.runs ?? [],
      },
    };
  }

  // v7 -> v8: 8 new AdjustmentKind values plus per-channel Curves/Hue-Saturation/Levels. Every new
  // field backfills from a fresh default object for this layer's own kind (matching this file's
  // idempotent-?? convention, just computed via createDefaultAdjustmentData instead of one literal
  // per field, since there are now ~20 of them) — nested objects merge shallowly so an old partial
  // shape (e.g. `curves: { rgb }` with no `r`/`g`/`b`/`luminosity`) keeps its real old data and only
  // gains the new keys.
  if (l.type === 'adjustment' && l.adjustment) {
    const a = l.adjustment;
    const d = createDefaultAdjustmentData(a.kind);
    migrated = {
      ...migrated,
      adjustment: {
        ...d,
        ...a,
        curves: { ...d.curves, ...a.curves },
        hueSaturationByChannel: { ...d.hueSaturationByChannel, ...a.hueSaturationByChannel },
        levelsByChannel: { ...d.levelsByChannel, ...a.levelsByChannel },
        gradientMap: { ...d.gradientMap, ...a.gradientMap },
        blackWhite: { ...d.blackWhite, ...a.blackWhite },
        photoFilter: { ...d.photoFilter, ...a.photoFilter },
        channelMixer: { ...d.channelMixer, ...a.channelMixer },
        colorLookup: { ...d.colorLookup, ...a.colorLookup },
        selectiveColor: { ...d.selectiveColor, ...a.selectiveColor, colors: { ...d.selectiveColor.colors, ...a.selectiveColor?.colors } },
        shadowsHighlights: { ...d.shadowsHighlights, ...a.shadowsHighlights },
        hdrToning: { ...d.hdrToning, ...a.hdrToning },
      },
    };
  }

  // Blend If's `channel` selector, added alongside its pre-existing thisLayer/underlying ranges —
  // old persisted effects have the ranges but no channel, defaulting to Gray (Photoshop's own
  // default) exactly as `createDefaultLayerEffects` already does for a brand-new layer.
  if (l.effects) {
    migrated = {
      ...migrated,
      effects: { ...l.effects, blendIf: { ...l.effects.blendIf, channel: l.effects.blendIf.channel ?? 'gray' } },
    };
  }

  return l.children ? { ...migrated, children: l.children.map(migrateLayer) } : migrated;
}

/**
 * v1 -> v2: text layers gained `autoWidth`, `letterSpacing` and `shadow`. Chapters saved
 * before that have text layers missing those keys entirely, and the renderer/panel read
 * `text.shadow.enabled` directly — so without this they'd throw on open. Backfills the
 * pre-v2 behaviour: fixed-width box text, no tracking, no shadow.
 *
 * v2 -> v3: text layers gained `gradient`. Backfills gradient-off, i.e. the flat `color` fill.
 *
 * v3 -> v4: text layers gained `runs` (per-character overrides). Backfills `[]`, i.e. the whole
 * layer renders in its own flat style — exactly the pre-v4 behaviour.
 *
 * v4 -> v5: layers became a tree — `children` (groups), `mask`, `clipped` and `collapsed`. All of
 * them are *optional*, and absent is precisely the pre-v5 behaviour (a flat stack of unmasked,
 * unclipped, ungrouped layers), so v5 adds no backfill of its own. It only makes the existing text
 * backfills recurse, which is a no-op on pre-v5 data since nothing is a group yet.
 *
 * Every backfill below is an idempotent `??`, so this single pass handles any older version
 * (v1 -> v5 as correctly as v4 -> v5) without needing a per-step chain. Keep that property: a new
 * field goes in `migrateLayer` as one more `??`, never as an `if (version === n)` branch.
 */
function migrateStudioLayers(data: ChapterStudioData): ChapterStudioData {
  const layersByPage: Record<string, SerializedStudioLayer[]> = {};
  for (const [pageId, layers] of Object.entries(data.layersByPage ?? {})) {
    layersByPage[pageId] = (layers ?? []).map(migrateLayer);
  }

  // v5 -> v6: TypeR styles gained a real folder tree (`TyperFolder`, `TyperStyle.folderId`)
  // replacing the old cosmetic `TyperStyle.folder` name string, plus configurable
  // ignoreLinePrefixes/ignoreTags/defaultStyleId. Synthesize one root-level folder per distinct
  // legacy folder name and repoint styles at it; a style that already has `folderId` (including
  // `null`, meaning already-unsorted) passes through untouched.
  const legacyStyles = (data.typerStyles ?? []) as (TyperStyle & { folder?: string })[];
  let typerFolders = data.typerFolders ?? [];
  if (!typerFolders.length) {
    const names = Array.from(new Set(legacyStyles.map(s => s.folder).filter((f): f is string => !!f)));
    typerFolders = names.map((name, index) => ({ id: `folder-legacy-${index}`, name, parentId: null, order: index }));
  }
  const typerStyles: TyperStyle[] = legacyStyles.map(s => {
    if (s.folderId !== undefined) return s as TyperStyle;
    const { folder, ...rest } = s;
    const matchedFolder = typerFolders.find(f => f.name === folder);
    return { ...rest, folderId: matchedFolder?.id ?? null };
  });

  return {
    ...data,
    layersByPage,
    typerStyles,
    typerFolders,
    ignoreLinePrefixes: data.ignoreLinePrefixes ?? ['##'],
    ignoreTags: data.ignoreTags ?? [],
    defaultStyleId: data.defaultStyleId ?? null,
    schemaVersion: SCHEMA_VERSION,
  };
}

export async function loadChapterStudioData(chapterId: string): Promise<ChapterStudioData | null> {
  const saved = await get(studioKey(chapterId));
  if (!saved || typeof saved !== 'object') return null;
  const data = saved as ChapterStudioData;
  // Anything older than the current schema (including pre-versioning saves, where
  // schemaVersion is undefined) gets normalized rather than trusted as-is.
  if (data.schemaVersion !== SCHEMA_VERSION) return migrateStudioLayers(data);
  return data;
}

export async function saveChapterStudioData(chapterId: string, data: ChapterStudioData): Promise<void> {
  await set(studioKey(chapterId), data);
}

export async function pushVersionSnapshot(chapterId: string, data: ChapterStudioData, label?: string): Promise<void> {
  const existing = (await get(versionsKey(chapterId))) as StudioVersionSnapshot[] | undefined;
  const versions = Array.isArray(existing) ? existing : [];
  const snapshot: StudioVersionSnapshot = { id: genId('ver'), timestamp: new Date().toISOString(), label, data };
  const next = [...versions, snapshot].slice(-MAX_VERSIONS);
  await set(versionsKey(chapterId), next);
}

export async function listVersions(chapterId: string): Promise<StudioVersionSnapshot[]> {
  const saved = await get(versionsKey(chapterId));
  return Array.isArray(saved) ? saved : [];
}

export async function restoreVersion(chapterId: string, versionId: string): Promise<ChapterStudioData | null> {
  const versions = await listVersions(chapterId);
  const found = versions.find(v => v.id === versionId);
  if (!found) return null;
  await saveChapterStudioData(chapterId, found.data);
  return found.data;
}
