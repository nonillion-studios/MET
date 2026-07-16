import { get, set } from 'idb-keyval';
import type { TextLayerData } from '../components/studio/studioTypes';

/**
 * Reusable named text styles, split the way Photoshop splits them.
 *
 * A character style carries appearance; a paragraph style carries layout. Applying one touches
 * only its own subset — which is the entire reason the two are separate: a paragraph style has to
 * be able to restyle layout without overwriting the font, and vice versa.
 *
 * Both kinds are stored in one list and one key; `kind` decides which subset a style captures and
 * applies, so there's deliberately no separate per-kind store.
 */
export type TextStyleKind = 'character' | 'paragraph';

export const CHARACTER_STYLE_KEYS = [
  'fontFamily', 'fontSize', 'color', 'bold', 'italic', 'letterSpacing',
  'strokeColor', 'strokeWidth', 'shadow', 'gradient',
] as const satisfies readonly (keyof TextLayerData)[];

export const PARAGRAPH_STYLE_KEYS = [
  'align', 'lineHeight', 'autoWidth',
] as const satisfies readonly (keyof TextLayerData)[];

export type CharacterStyleFields = Pick<TextLayerData, (typeof CHARACTER_STYLE_KEYS)[number]>;
export type ParagraphStyleFields = Pick<TextLayerData, (typeof PARAGRAPH_STYLE_KEYS)[number]>;
export type TextStyleFields = Partial<CharacterStyleFields & ParagraphStyleFields>;

export interface TextStyle {
  id: string;
  name: string;
  kind: TextStyleKind;
  fields: TextStyleFields;
}

/** The single source of truth for which keys each kind owns — used by both capture and apply. */
export function styleKeysFor(kind: TextStyleKind): readonly (keyof TextLayerData)[] {
  return kind === 'character' ? CHARACTER_STYLE_KEYS : PARAGRAPH_STYLE_KEYS;
}

/**
 * Snapshots the given kind's fields off a live layer. Deep-copies so a saved style can never
 * share a nested `shadow`/`gradient` object with the layer it was captured from.
 */
export function captureStyleFields(text: TextLayerData, kind: TextStyleKind): TextStyleFields {
  const fields: Record<string, unknown> = {};
  for (const key of styleKeysFor(kind)) fields[key] = structuredClone(text[key]);
  return fields as TextStyleFields;
}

/** The patch to hand to a text layer's onUpdate. Deep-copied for the same reason as capture. */
export function styleToPatch(style: TextStyle): Partial<TextLayerData> {
  const patch: Record<string, unknown> = {};
  for (const key of styleKeysFor(style.kind)) {
    const value = (style.fields as Record<string, unknown>)[key];
    if (value !== undefined) patch[key] = structuredClone(value);
  }
  return patch as Partial<TextLayerData>;
}

const STORAGE_KEY = 'text_styles';
export const TEXT_STYLE_SCHEMA_VERSION = 1;

interface TextStyleRecord {
  schemaVersion: number;
  styles: TextStyle[];
}

export async function loadTextStyles(): Promise<TextStyle[]> {
  const saved = await get(STORAGE_KEY);
  if (!saved || typeof saved !== 'object') return [];
  const record = saved as TextStyleRecord;
  // Nothing older than v1 exists yet; anything unrecognized is discarded rather than trusted,
  // since a style carrying half-migrated fields would silently corrupt any layer it's applied to.
  if (record.schemaVersion !== TEXT_STYLE_SCHEMA_VERSION) return [];
  return Array.isArray(record.styles) ? record.styles : [];
}

export async function saveTextStyles(styles: TextStyle[]): Promise<void> {
  const record: TextStyleRecord = { schemaVersion: TEXT_STYLE_SCHEMA_VERSION, styles };
  await set(STORAGE_KEY, record);
}
