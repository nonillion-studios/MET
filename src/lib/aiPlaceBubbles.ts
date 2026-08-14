/** Gemini vision call for the Automation pipeline's Translation stage — "From Text Editor" branch.
 *  Unlike `aiTranslateBubbles.ts` (which translates AND places), this is placement-only: the text
 *  is already translated (it came from a Text Editor document the user wrote/synced), so this just
 *  asks Gemini to find where each already-translated line goes on the page and returns position/
 *  style JSON, keyed by index into the given paragraph list rather than echoing the text back —
 *  having Gemini retype a paragraph verbatim risks transcription drift on anything longer than a
 *  few words, whereas an index is unambiguous and costs nothing to get exactly right. */

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

const GEMINI_TEXT_MODEL = 'gemini-flash-latest';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
function parseHexColor(v: unknown): string | undefined {
  return typeof v === 'string' && HEX_COLOR_RE.test(v.trim()) ? v.trim() : undefined;
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new AiPlaceBubblesError('Page image is not a base64 data URL.');
  return { mimeType: match[1], base64: match[2] };
}

async function readErrorDetail(res: Response): Promise<string> {
  const errText = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(errText);
    return parsed?.error?.message || parsed?.message || errText;
  } catch {
    return errText;
  }
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
  if (start === -1 || end === -1 || end < start) throw new AiPlaceBubblesError('Gemini reply was not a JSON array.');
  const parsed = JSON.parse(stripped.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new AiPlaceBubblesError('Gemini reply was not a JSON array.');
  return parsed;
}

/** Places `paragraphs` (already-translated text, in whatever order the Text Editor document had
 *  them) onto `imageDataUrl`'s bubbles/SFX. Returns at most one entry per input paragraph, each
 *  with a valid, in-range, not-yet-used `paragraphIndex` — malformed or duplicate indices are
 *  dropped rather than failing the whole page. */
export async function placeTranslatedBubbles(imageDataUrl: string, paragraphs: string[], extraPrompt: string, apiKey: string, model?: string): Promise<PlacedBubble[]> {
  if (!apiKey) throw new AiPlaceBubblesError('No Gemini API key configured — add one in Settings.');
  if (paragraphs.length === 0) return [];
  const { mimeType, base64 } = parseDataUrl(imageDataUrl);
  const resolvedModel = model?.trim() || GEMINI_TEXT_MODEL;
  const instructions = buildPrompt(paragraphs, extraPrompt);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolvedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: instructions },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
      }),
    }
  );
  if (!res.ok) throw new AiPlaceBubblesError(`Gemini request failed (${res.status}): ${(await readErrorDetail(res)) || res.statusText}`);
  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text ?? '').join('') : '';
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
