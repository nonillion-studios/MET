/** Vision call for the Automation pipeline's Translation stage — "From Text Editor" branch. Unlike
 *  `aiTranslateBubbles.ts` (which translates AND places), this is placement-only: the text is
 *  already translated (it came from a Text Editor document the user wrote/synced), so this just
 *  asks the model to find where each already-translated line goes on the page and returns position/
 *  style JSON, keyed by index into the given paragraph list rather than echoing the text back —
 *  having the model retype a paragraph verbatim risks transcription drift on anything longer than a
 *  few words, whereas an index is unambiguous and costs nothing to get exactly right. Reaches any of
 *  `aiTranslate.ts`'s supported providers through its shared `callVisionProvider`. */
import { callVisionProvider, type AiProvider } from './aiTranslate';

export class AiPlaceBubblesError extends Error {}

export interface PlacedBubble {
  /** Index into the paragraph list this call was given — resolved back to real text locally,
   *  never trusted from Gemini's own retyping of it. */
  paragraphIndex: number;
  isSfx: boolean;
  seedX: number;
  seedY: number;
  rotation: number;
  bold?: boolean;
  italic?: boolean;
  emphasis?: boolean;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  shadowEnabled?: boolean;
  shadowColor?: string;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
function parseHexColor(v: unknown): string | undefined {
  return typeof v === 'string' && HEX_COLOR_RE.test(v.trim()) ? v.trim() : undefined;
}

function buildPrompt(paragraphs: string[], extraPrompt: string): string {
  const numbered = paragraphs.map((p, i) => `${i}: ${p}`).join('\n');
  return [
    'You are typesetting a manga/manhwa page. The lines below are ALREADY TRANSLATED — do not translate, rewrite, or alter them in any way. Your only job is to find which bubble/SFX each numbered line belongs to on the page image and report where to place it.',
    extraPrompt.trim() ? `Additional instructions from the translator: ${extraPrompt.trim()}` : '',
    'Numbered lines (index: text):',
    numbered,
    'Reply with ONLY a raw JSON array (no markdown fences, no commentary), one object per line you could confidently place:',
    '[{ "paragraphIndex": number, "isSfx": boolean, "seedX": number, "seedY": number, "rotation": number, "bold": boolean, "italic": boolean, "emphasis": boolean, "color": string, "strokeColor": string, "strokeWidth": number, "shadowEnabled": boolean, "shadowColor": string }]',
    '"paragraphIndex" MUST be one of the numbers given above, used at most once each.',
    '"seedX"/"seedY" are a rough point INSIDE that bubble/SFX (0..1, fraction of page width/height) — approximate is fine.',
    'If you cannot confidently match a line to a bubble on this page, leave it out rather than guessing — a missing line is far less harmful than a wrongly-placed one.',
    'The other fields (rotation, bold/italic/emphasis, color/strokeColor/strokeWidth, shadowEnabled/shadowColor) are optional styling — see the note on legibility below.',
    'Look at what\'s behind/around each bubble and choose readable styling: a stroke color that contrasts with the bubble\'s own fill (e.g. white stroke on a dark/colored bubble, none needed on plain white).',
  ].filter(Boolean).join('\n');
}

function parseJsonArray(raw: string): unknown[] {
  const stripped = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) throw new AiPlaceBubblesError('AI reply was not a JSON array.');
  const parsed = JSON.parse(stripped.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new AiPlaceBubblesError('AI reply was not a JSON array.');
  return parsed;
}

export interface PlaceBubblesProvider {
  provider: AiProvider;
  apiKey: string;
  /** Falls back to the provider's own default model when blank. */
  model: string;
  /** Only used by OpenAI-compatible providers — see `openAiCompatible` on AiProviderInfo. */
  baseUrl?: string;
}

/** Places `paragraphs` (already-translated text, in whatever order the Text Editor document had
 *  them) onto `imageDataUrl`'s bubbles/SFX. Returns at most one entry per input paragraph, each
 *  with a valid, in-range, not-yet-used `paragraphIndex` — malformed or duplicate indices are
 *  dropped rather than failing the whole page. */
export async function placeTranslatedBubbles(imageDataUrl: string, paragraphs: string[], extraPrompt: string, providerConfig: PlaceBubblesProvider): Promise<PlacedBubble[]> {
  if (!providerConfig.apiKey && providerConfig.provider !== 'ollama') throw new AiPlaceBubblesError('No API key configured for this provider — add one in Settings.');
  if (paragraphs.length === 0) return [];
  const instructions = buildPrompt(paragraphs, extraPrompt);

  let text: string;
  try {
    text = await callVisionProvider({
      provider: providerConfig.provider, apiKey: providerConfig.apiKey, model: providerConfig.model,
      imageDataUrl, instructions, baseUrl: providerConfig.baseUrl,
    });
  } catch (err) {
    throw new AiPlaceBubblesError(err instanceof Error ? err.message : 'Placement request failed.');
  }
  if (!text.trim()) return [];

  const rawItems = parseJsonArray(text);
  const used = new Set<number>();
  const placed: PlacedBubble[] = [];
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const idx = Number(o.paragraphIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= paragraphs.length || used.has(idx)) continue;
    used.add(idx);
    placed.push({
      paragraphIndex: idx,
      isSfx: o.isSfx === true,
      seedX: Math.min(1, Math.max(0, Number(o.seedX) || 0.5)),
      seedY: Math.min(1, Math.max(0, Number(o.seedY) || 0.5)),
      rotation: Number.isFinite(o.rotation) ? Number(o.rotation) : 0,
      bold: typeof o.bold === 'boolean' ? o.bold : undefined,
      italic: typeof o.italic === 'boolean' ? o.italic : undefined,
      emphasis: typeof o.emphasis === 'boolean' ? o.emphasis : undefined,
      color: parseHexColor(o.color),
      strokeColor: parseHexColor(o.strokeColor),
      strokeWidth: Number.isFinite(o.strokeWidth) ? Math.min(10, Math.max(0, Number(o.strokeWidth))) : undefined,
      shadowEnabled: typeof o.shadowEnabled === 'boolean' ? o.shadowEnabled : undefined,
      shadowColor: parseHexColor(o.shadowColor),
    });
  }
  return placed;
}
