export type AiProvider = 'gemini' | 'openai' | 'anthropic';

export interface AiProviderInfo {
  id: AiProvider;
  label: string;
  defaultModel: string;
  /** Shown next to the API key field so it's obvious which service the pasted key belongs to. */
  keyHint: string;
}

/** Single source of truth for the Settings dropdown and this module's own default-model fallback
 *  — every provider integration below is driven by this list plus its own request builder. */
export const AI_PROVIDERS: AiProviderInfo[] = [
  { id: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-2.0-flash', keyHint: 'Gemini API key (aistudio.google.com)' },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o', keyHint: 'OpenAI API key (platform.openai.com)' },
  { id: 'anthropic', label: 'Anthropic Claude', defaultModel: 'claude-sonnet-4-20250514', keyHint: 'Anthropic API key (console.anthropic.com)' },
];

export function defaultModelFor(provider: AiProvider): string {
  return AI_PROVIDERS.find(p => p.id === provider)?.defaultModel ?? '';
}

export interface TranslatePageParams {
  provider: AiProvider;
  apiKey: string;
  /** Falls back to the provider's default model when blank (e.g. an older saved setting). */
  model: string;
  /** A `data:<mime>;base64,<data>` URL — a page's `original`/`cleaned` ProcessedImage.dataUrl. */
  imageDataUrl: string;
  /** The user's custom instructions from Settings (tone, honorifics, etc.) — appended, not required. */
  prompt: string;
  targetLanguage: string;
}

/** Lightweight markup the reply is asked to use, parsed back out by `aiTypewriter.ts`'s tokenizer:
 *  `**bold**`, `//italic//`, and a blank line between separate speech bubbles/captions. Kept simple
 *  and easy for a vision model to follow reliably, rather than asking for real HTML/JSON — shared
 *  across every provider so a switch in Settings doesn't change what the typewriter has to parse. */
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
  if (!match) throw new Error('Page image is not a base64 data URL — cannot send it to the AI provider.');
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

async function translateWithGemini({ apiKey, model, imageDataUrl, prompt, targetLanguage }: TranslatePageParams): Promise<string> {
  const { mimeType, base64 } = parseDataUrl(imageDataUrl);
  const instructions = buildInstructions(prompt, targetLanguage);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
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
  if (!res.ok) throw new Error(`Gemini request failed (${res.status}): ${(await readErrorDetail(res)) || res.statusText}`);
  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text ?? '').join('') : '';
  return text.trim();
}

async function translateWithOpenAI({ apiKey, model, imageDataUrl, prompt, targetLanguage }: TranslatePageParams): Promise<string> {
  const instructions = buildInstructions(prompt, targetLanguage);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: instructions },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI request failed (${res.status}): ${(await readErrorDetail(res)) || res.statusText}`);
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? '';
  return String(text).trim();
}

async function translateWithAnthropic({ apiKey, model, imageDataUrl, prompt, targetLanguage }: TranslatePageParams): Promise<string> {
  const { mimeType, base64 } = parseDataUrl(imageDataUrl);
  const instructions = buildInstructions(prompt, targetLanguage);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Anthropic's API is CORS-blocked for browser calls by default — this header is Anthropic's
      // own documented opt-in for direct client-side use. Same trust model this app already uses
      // for every provider: the decrypted key lives in the browser for the run's duration only.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: instructions },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic request failed (${res.status}): ${(await readErrorDetail(res)) || res.statusText}`);
  const json = await res.json();
  const parts = json?.content;
  const text = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text ?? '').join('') : '';
  return text.trim();
}

/** Sends one manga page image to the configured provider's vision API and returns the translated
 *  markup text. Called directly from the browser with the user's own decrypted key — same
 *  client-side-call trust model this app already uses for Telegram (see aiSettingsStore.ts). */
export async function translatePageImage(params: TranslatePageParams): Promise<string> {
  const resolved: TranslatePageParams = { ...params, model: params.model.trim() || defaultModelFor(params.provider) };
  switch (resolved.provider) {
    case 'gemini': return translateWithGemini(resolved);
    case 'openai': return translateWithOpenAI(resolved);
    case 'anthropic': return translateWithAnthropic(resolved);
  }
}
