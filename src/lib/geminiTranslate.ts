const GEMINI_MODEL = 'gemini-2.0-flash';

export interface TranslatePageParams {
  apiKey: string;
  /** A `data:<mime>;base64,<data>` URL — a page's `original`/`cleaned` ProcessedImage.dataUrl. */
  imageDataUrl: string;
  /** The user's custom instructions from Settings (tone, honorifics, etc.) — appended, not required. */
  prompt: string;
  targetLanguage: string;
}

/** Lightweight markup the reply is asked to use, parsed back out by `aiTypewriter.ts`'s tokenizer:
 *  `**bold**`, `//italic//`, and a blank line between separate speech bubbles/captions. Kept simple
 *  and easy for a vision model to follow reliably, rather than asking for real HTML/JSON. */
function buildInstructions(prompt: string, targetLanguage: string): string {
  const lang = targetLanguage.trim() || 'English';
  return [
    `You are translating dialogue, captions and sound effects from a manga/manhwa page image into ${lang}.`,
    prompt.trim() ? `Additional instructions from the translator: ${prompt.trim()}` : '',
    'Read every speech bubble, caption and sound effect on the page in natural reading order.',
    'Reply with ONLY the translated lines, in reading order, formatted as plain text using this lightweight markup:',
    '- Wrap emphasized/shouted text in **double asterisks** for bold.',
    '- Wrap sound effects or whispered text in //double slashes// for italic.',
    '- Put a blank line between separate speech bubbles or captions.',
    '- Use a single line break for a line break within the same bubble.',
    'Do not include bubble numbers, coordinates, speaker labels, translator notes, or any commentary — only the translated text itself. If the page has no text, reply with an empty response.',
  ].filter(Boolean).join('\n');
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Page image is not a base64 data URL — cannot send it to Gemini.');
  return { mimeType: match[1], base64: match[2] };
}

/** Sends one manga page image to Gemini's vision API and returns the translated markup text.
 *  Called directly from the browser with the user's own decrypted key — same client-side-call
 *  trust model this app already uses for Telegram (see geminiSettingsStore.ts). */
export async function translatePageImage({ apiKey, imageDataUrl, prompt, targetLanguage }: TranslatePageParams): Promise<string> {
  const { mimeType, base64 } = parseDataUrl(imageDataUrl);
  const instructions = buildInstructions(prompt, targetLanguage);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
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

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let detail = errText;
    try {
      const parsed = JSON.parse(errText);
      detail = parsed?.error?.message || errText;
    } catch {
      // errText wasn't JSON — use it as-is.
    }
    throw new Error(`Gemini request failed (${res.status}): ${detail || res.statusText}`);
  }

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text ?? '').join('') : '';
  return text.trim();
}
