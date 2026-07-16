import { get, set } from 'idb-keyval';
import { genId } from './id';
import { DEFAULT_TEXT_SHADOW, DEFAULT_TEXT_GRADIENT, type StudioLayer, type TyperStyle } from '../components/studio/studioTypes';

/** Bump + add a migration step in loadChapterStudioData whenever the persisted shape changes. */
export const STUDIO_SCHEMA_VERSION = 4;
const SCHEMA_VERSION = STUDIO_SCHEMA_VERSION;
const MAX_VERSIONS = 10;

/** A StudioLayer plus its raster pixel content (only present for layer types that carry pixels, e.g. 'clean-patch'). */
export type SerializedStudioLayer = StudioLayer & { raster?: string };

export interface ChapterStudioData {
  schemaVersion: typeof SCHEMA_VERSION;
  layersByPage: Record<string, SerializedStudioLayer[]>;
  typerScript: string;
  typerStyles: TyperStyle[];
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
  return { schemaVersion: SCHEMA_VERSION, layersByPage: {}, typerScript: '', typerStyles: [], updatedAt: new Date().toISOString() };
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
 * Every backfill below is an idempotent `??`, so this single pass handles any older version
 * (v1 -> v3 as correctly as v2 -> v3) without needing a per-step chain.
 */
function migrateTextLayers(data: ChapterStudioData): ChapterStudioData {
  const layersByPage: Record<string, SerializedStudioLayer[]> = {};
  for (const [pageId, layers] of Object.entries(data.layersByPage ?? {})) {
    layersByPage[pageId] = (layers ?? []).map((l) => {
      if (l.type !== 'text' || !l.text) return l;
      return {
        ...l,
        text: {
          ...l.text,
          autoWidth: l.text.autoWidth ?? false,
          letterSpacing: l.text.letterSpacing ?? 0,
          shadow: l.text.shadow ?? { ...DEFAULT_TEXT_SHADOW },
          gradient: l.text.gradient ?? { ...DEFAULT_TEXT_GRADIENT },
          runs: l.text.runs ?? [],
        },
      };
    });
  }
  return { ...data, layersByPage, schemaVersion: SCHEMA_VERSION };
}

export async function loadChapterStudioData(chapterId: string): Promise<ChapterStudioData | null> {
  const saved = await get(studioKey(chapterId));
  if (!saved || typeof saved !== 'object') return null;
  const data = saved as ChapterStudioData;
  // Anything older than the current schema (including pre-versioning saves, where
  // schemaVersion is undefined) gets normalized rather than trusted as-is.
  if (data.schemaVersion !== SCHEMA_VERSION) return migrateTextLayers(data);
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
