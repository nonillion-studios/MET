import { get, set } from 'idb-keyval';
import { genId } from './id';
import type { StudioLayer, TyperStyle } from '../components/studio/studioTypes';

const SCHEMA_VERSION = 1;
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

export async function loadChapterStudioData(chapterId: string): Promise<ChapterStudioData | null> {
  const saved = await get(studioKey(chapterId));
  if (!saved || typeof saved !== 'object') return null;
  // Forward-compat: unknown/missing schemaVersion is treated as the current shape; add
  // real migration steps here if ChapterStudioData's shape changes in the future.
  return saved as ChapterStudioData;
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
