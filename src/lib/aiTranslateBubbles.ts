/** Gemini vision call for the Automation pipeline's Translation stage — reads a manga/manhwa page
 *  and returns one structured entry per bubble/SFX instead of `aiTranslate.ts`'s plain markup, so
 *  the Typesetting stage (`autoTypeset.ts`) has enough to place and size each one without the user
 *  drawing a bubble rect by hand. Same REST shape as `aiTranslate.ts`/`aiInpaint.ts` (same
 *  `generativelanguage.googleapis.com` base, same key), just a JSON-mode request/response. */

export class AiTranslateBubblesError extends Error {}

export interface TranslatedBubble {
  text: string;
  isSfx: boolean;
  /** A point inside the bubble, 0..1 normalized to the page's own width/height — a rough guess
   *  Gemini is explicitly told doesn't need to be precise, since `autoTypeset.ts` flood-fills from
   *  it (via StudioCanvas's existing `detectBubbleBounds`) to find the bubble's real extent. */
  seedX: number;
  seedY: number;
  rotation: number;
}

// 'gemini-2.0-flash' was retired by Google (confirmed live: now 404s "no longer available") — a
// rolling alias instead of a dated snapshot, so this doesn't go stale the same way again.
const GEMINI_TEXT_MODEL = 'gemini-flash-latest';

export const AUTOMATION_DEFAULT_TRANSLATE_PROMPT = 'Translate naturally, preserving tone and any honorifics.';

export interface PageContext {
  pageIndex: number;
  pageCount: number;
}

function buildPrompt(prompt: string, targetLanguage: string, blackAndWhiteOnly: boolean, pageContext?: PageContext): string {
  return [
    `You are reading a manga/manhwa page and translating every speech bubble, caption and sound effect (SFX) into ${targetLanguage.trim() || 'English'}.`,
    pageContext && pageContext.pageCount > 0
      ? `This is page ${pageContext.pageIndex + 1} of ${pageContext.pageCount} in the current chapter — dialogue, captions or sound effects may continue from the previous page, so keep reading-order/tone continuity in mind.`
      : '',
    prompt.trim() ? `Additional instructions from the translator: ${prompt.trim()}` : '',
    blackAndWhiteOnly ? 'This page is black-and-white manga — do not suggest any color; typesetting will stay black/white.' : '',
    'Reply with ONLY a raw JSON array (no markdown fences, no commentary), one object per bubble/SFX, in natural reading order:',
    '[{ "text": string, "isSfx": boolean, "seedX": number, "seedY": number, "rotation": number }]',
    '"seedX"/"seedY" are a rough point INSIDE that bubble/SFX (0..1, fraction of page width/height) — approximate is fine.',
    '"rotation" is degrees clockwise the text should be tilted (usually 0; SFX is sometimes angled with the art).',
    'Skip bubbles/SFX with no legible text. If the page has no text at all, reply with an empty array [].',
  ].filter(Boolean).join('\n');
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new AiTranslateBubblesError('Page image is not a base64 data URL.');
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

function parseJsonArray(raw: string): unknown[] {
  const stripped = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) throw new AiTranslateBubblesError('Gemini reply was not a JSON array.');
  const parsed = JSON.parse(stripped.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new AiTranslateBubblesError('Gemini reply was not a JSON array.');
  return parsed;
}

export async function translatePageBubbles(imageDataUrl: string, prompt: string, targetLanguage: string, blackAndWhiteOnly: boolean, apiKey: string, pageContext?: PageContext): Promise<TranslatedBubble[]> {
  if (!apiKey) throw new AiTranslateBubblesError('No Gemini API key configured — add one in Settings.');
  const { mimeType, base64 } = parseDataUrl(imageDataUrl);
  const instructions = buildPrompt(prompt, targetLanguage, blackAndWhiteOnly, pageContext);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_TEXT_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
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
  if (!res.ok) throw new AiTranslateBubblesError(`Gemini request failed (${res.status}): ${(await readErrorDetail(res)) || res.statusText}`);
  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text ?? '').join('') : '';
  if (!text.trim()) return [];
  return parseBubblesFromJsonText(text);
}

/** Parses a raw JSON-array reply (Gemini's own, or one an external AI tool's reply was pasted in
 *  from — see the JSON Hand-off panel) into validated bubbles, silently dropping malformed entries
 *  rather than failing the whole page over one bad item. Shared so both paths validate identically. */
export function parseBubblesFromJsonText(text: string): TranslatedBubble[] {
  const rawItems = parseJsonArray(text);
  const bubbles: TranslatedBubble[] = [];
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.text !== 'string' || !o.text.trim()) continue;
    bubbles.push({
      text: o.text.trim(),
      isSfx: o.isSfx === true,
      seedX: Math.min(1, Math.max(0, Number(o.seedX) || 0.5)),
      seedY: Math.min(1, Math.max(0, Number(o.seedY) || 0.5)),
      rotation: Number.isFinite(o.rotation) ? Number(o.rotation) : 0,
    });
  }
  return bubbles;
}

/** The prompt text an external AI tool needs for the JSON Hand-off panel — same schema
 *  `buildPrompt`/`translatePageBubbles` asks Gemini for, so a pasted-back reply parses identically
 *  either way. */
export function buildHandoffPrompt(targetLanguage: string): string {
  return [
    buildPrompt('', targetLanguage, false),
    '',
    "Paste this one page's image into your AI tool along with this prompt, then paste its JSON reply back into Studio's Automation › JSON Hand-off panel to typeset it automatically.",
  ].join('\n');
}
