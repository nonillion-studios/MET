/** Gemini image call for the Automation pipeline's Coloring stage — same shape as `aiInpaint.ts`,
 *  but run against the *inpainted* layer (text already removed) rather than the original scan, per
 *  the pipeline's own ordering: color goes on top of a clean page, never a page with foreign text
 *  still on it. */

export class AiColorError extends Error {}

const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

export const AUTOMATION_DEFAULT_COLOR_PROMPT = [
  'Colorize this black-and-white manga page. Keep character designs, outfits, and linework exactly as drawn —',
  'only add color. Use natural, consistent lighting and keep skin tones, hair, and outfit colors consistent',
  'across panels on this page.',
].join(' ');

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new AiColorError('Page image is not a base64 data URL — cannot send it to Gemini.');
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

/** Sends the inpainted page (plus, optionally, a short summary of the translated bubble text so
 *  Gemini has story context for color choices) to Gemini and returns the colorized page as a
 *  `data:` URL. */
export async function colorPageWithGemini(inpaintedDataUrl: string, prompt: string, apiKey: string): Promise<string> {
  if (!apiKey) throw new AiColorError('No Gemini API key configured — add one in Settings.');
  const { mimeType, base64 } = parseDataUrl(inpaintedDataUrl);

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
              { text: prompt.trim() || AUTOMATION_DEFAULT_COLOR_PROMPT },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          }],
        }),
      }
    );
  } catch (err) {
    throw new AiColorError(err instanceof Error ? err.message : 'Network request to Gemini failed.');
  }

  if (!res.ok) throw new AiColorError(`Gemini request failed (${res.status}): ${(await readErrorDetail(res)) || res.statusText}`);

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts as Array<{ inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }> | undefined;
  const imagePart = parts?.find(p => p.inlineData?.data || p.inline_data?.data);
  const data = imagePart?.inlineData?.data ?? imagePart?.inline_data?.data;
  const outMime = imagePart?.inlineData?.mimeType ?? imagePart?.inline_data?.mime_type ?? 'image/png';
  if (!data) throw new AiColorError('Gemini did not return a colorized image for this page.');
  return `data:${outMime};base64,${data}`;
}
