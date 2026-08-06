import { get, set, del, keys } from 'idb-keyval';
import type { SerializedStudioLayer } from '../lib/studioProjectStore';

/**
 * Design Mode images persist under their own `design_<imageId>` keys — separate from Studio's
 * `studio_<chapterId>` keys (`studioProjectStore.ts`) so the two document spaces can never collide.
 * Reuses `SerializedStudioLayer` (already the shape `StudioLayer` serializes to for Studio's own
 * persistence/export) rather than inventing a parallel serialized-layer type.
 */
export const DESIGN_SCHEMA_VERSION = 1;

export interface DesignImageData {
  schemaVersion: typeof DESIGN_SCHEMA_VERSION;
  id: string;
  name: string;
  width: number;
  height: number;
  layers: SerializedStudioLayer[];
  thumbnail: string;
  updatedAt: string;
}

export const DESIGN_KEY_PREFIX = 'design_';

/** Exported for unit testing the prefix logic itself, independent of a real IndexedDB — this is
 *  what guarantees Design Mode data can never collide with `studio_<chapterId>` keys. */
export function designKey(imageId: string): string {
  return `${DESIGN_KEY_PREFIX}${imageId}`;
}

export function imageIdFromDesignKey(key: string): string | null {
  return key.startsWith(DESIGN_KEY_PREFIX) ? key.slice(DESIGN_KEY_PREFIX.length) : null;
}

export async function saveDesignImage(data: DesignImageData): Promise<void> {
  await set(designKey(data.id), data);
}

export async function loadDesignImage(imageId: string): Promise<DesignImageData | null> {
  const saved = await get(designKey(imageId));
  if (!saved || typeof saved !== 'object') return null;
  return saved as DesignImageData;
}

export async function deleteDesignImage(imageId: string): Promise<void> {
  await del(designKey(imageId));
}

/** Every persisted Design Mode image id, for restoring the tab set on load. `idb-keyval`'s default
 *  store is shared with Studio's `studio_<chapterId>` keys and others, so this filters by prefix
 *  rather than assuming the store holds only Design Mode data. */
export async function loadAllDesignImageIds(): Promise<string[]> {
  const allKeys = await keys();
  const ids: string[] = [];
  for (const k of allKeys) {
    const id = imageIdFromDesignKey(String(k));
    if (id !== null) ids.push(id);
  }
  return ids;
}
