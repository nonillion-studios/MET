/** Gemini image-editing call for the Automation pipeline's Inpainting stage — a sibling to
 *  `aiTranslate.ts`'s `translateWithGemini`, reusing the same REST shape (same
 *  `generativelanguage.googleapis.com` base, same `data:` URL parsing) but against an
 *  image-capable Gemini model that returns an edited image instead of text. */

export type AiInpaintErrorKind = 'no-key' | 'network' | 'quota' | 'no-image-returned';

export class AiInpaintError extends Error {
  kind: AiInpaintErrorKind;
  constructor(kind: AiInpaintErrorKind, message: string) {
    super(message);
    this.name = 'AiInpaintError';
    this.kind = kind;
  }
}

/** Gemini's image-editing-capable model ("nano banana") — independent of whatever text/vision
 *  model the user has picked in Settings for translation, since this call specifically needs an
 *  image part back in the response, not text. */
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

export const AUTOMATION_DEFAULT_INPAINT_PROMPT = [
  'Remove all non-Japanese text from this manga page (speech bubbles, sound effects, captions).',
  'Preserve any Japanese text exactly as-is — do not remove, translate, or alter it.',
  'Do not alter character art, linework, panel borders, or backgrounds outside the removed text regions.',
  'Reconstruct the underlying art/background naturally where text is removed.',
].join(' ');

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new AiInpaintError('no-image-returned', 'Page image is not a base64 data URL — cannot send it to Gemini.');
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

/** Sends one manga page image to Gemini's image-editing endpoint with an inpainting prompt and
 *  returns the edited page as a `data:` URL. Throws `AiInpaintError` on any failure so the
 *  automation run loop can record a per-page error and continue rather than aborting the run. */
export async function inpaintPageWithGemini(imageDataUrl: string, prompt: string, apiKey: string): Promise<string> {
  if (!apiKey) throw new AiInpaintError('no-key', 'No Gemini API key configured — add one in Settings.');
  const { mimeType, base64 } = parseDataUrl(imageDataUrl);

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_IMAGE_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt.trim() || AUTOMATION_DEFAULT_INPAINT_PROMPT },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          }],
        }),
      }
    );
  } catch (err) {
    throw new AiInpaintError('network', err instanceof Error ? err.message : 'Network request to Gemini failed.');
  }

  if (!res.ok) {
    const detail = (await readErrorDetail(res)) || res.statusText;
    const kind: AiInpaintErrorKind = res.status === 429 ? 'quota' : 'network';
    throw new AiInpaintError(kind, `Gemini request failed (${res.status}): ${detail}`);
  }

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts as Array<{ inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }> | undefined;
  const imagePart = parts?.find(p => p.inlineData?.data || p.inline_data?.data);
  const data = imagePart?.inlineData?.data ?? imagePart?.inline_data?.data;
  const outMime = imagePart?.inlineData?.mimeType ?? imagePart?.inline_data?.mime_type ?? 'image/png';
  if (!data) throw new AiInpaintError('no-image-returned', 'Gemini did not return an edited image for this page.');
  return `data:${outMime};base64,${data}`;
}
