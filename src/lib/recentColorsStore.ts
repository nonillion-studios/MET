import { get, set } from 'idb-keyval';

const STORAGE_KEY = 'recent_colors';

export async function loadRecentColors(): Promise<string[]> {
  const saved = await get(STORAGE_KEY);
  return Array.isArray(saved) ? saved : [];
}

export async function saveRecentColors(colors: string[]): Promise<void> {
  await set(STORAGE_KEY, colors);
}
