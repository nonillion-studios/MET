export type AiProvider = 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'openrouter' | 'groq' | 'mistral' | 'deepseek' | 'xai';

export interface AiProviderInfo {
  id: AiProvider;
  label: string;
  defaultModel: string;
  /** Shown next to the API key field so it's obvious which service the pasted key belongs to. */
  keyHint: string;
  /** True when this provider is called through an OpenAI-compatible /chat/completions endpoint
   *  (see `translateWithOpenAiCompatible`) rather than its own bespoke request shape. */
  openAiCompatible?: boolean;
  /** Default base URL for OpenAI-compatible providers — overridable in Settings (e.g. a
   *  self-hosted Ollama/LM Studio instance on a different host/port). */
  defaultBaseUrl?: string;
  /** True when this provider is reached over a base URL with no API key required (local/self-hosted). */
  noKeyRequired?: boolean;
}

/** Single source of truth for the Settings dropdown and this module's own default-model fallback
 *  — every provider integration below is driven by this list plus its own request builder. */
export const AI_PROVIDERS: AiProviderInfo[] = [
  { id: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-2.0-flash', keyHint: 'Gemini API key (aistudio.google.com)' },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o', keyHint: 'OpenAI API key (platform.openai.com)', openAiCompatible: true, defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic Claude', defaultModel: 'claude-sonnet-4-20250514', keyHint: 'Anthropic API key (console.anthropic.com)' },
  { id: 'ollama', label: 'Ollama (local)', defaultModel: 'llama3.2-vision', keyHint: 'No key needed — set the Base URL below', openAiCompatible: true, defaultBaseUrl: 'http://localhost:11434/v1', noKeyRequired: true },
  { id: 'openrouter', label: 'OpenRouter', defaultModel: 'openai/gpt-4o', keyHint: 'OpenRouter API key (openrouter.ai)', openAiCompatible: true, defaultBaseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'groq', label: 'Groq', defaultModel: 'llama-3.2-90b-vision-preview', keyHint: 'Groq API key (console.groq.com)', openAiCompatible: true, defaultBaseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', label: 'Mistral', defaultModel: 'pixtral-large-latest', keyHint: 'Mistral API key (console.mistral.ai)', openAiCompatible: true, defaultBaseUrl: 'https://api.mistral.ai/v1' },
  { id: 'deepseek', label: 'DeepSeek', defaultModel: 'deepseek-chat', keyHint: 'DeepSeek API key (platform.deepseek.com)', openAiCompatible: true, defaultBaseUrl: 'https://api.deepseek.com/v1' },
  { id: 'xai', label: 'xAI (Grok)', defaultModel: 'grok-2-vision-latest', keyHint: 'xAI API key (console.x.ai)', openAiCompatible: true, defaultBaseUrl: 'https://api.x.ai/v1' },
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
  /** 0-based position of this page within the current translation run, and the run's total page
   *  count — passed through so the model knows it's mid-chapter (e.g. dialogue/SFX may continue
   *  from the previous page) rather than treating every page as a standalone image. */
  pageIndex: number;
  pageCount: number;
  /** Only used by OpenAI-compatible providers (see `openAiCompatible` on AiProviderInfo) — the
   *  endpoint to call, e.g. a self-hosted Ollama instance or an alternate OpenRouter/Groq host. */
  baseUrl?: string;
}

/** Lightweight markup the reply is asked to use, parsed back out by `aiTypewriter.ts`'s tokenizer:
 *  `**bold**`, `//italic//`, and a blank line between separate speech bubbles/captions. Kept simple
 *  and easy for a vision model to follow reliably, rather than asking for real HTML/JSON — shared
 *  across every provider so a switch in Settings doesn't change what the typewriter has to parse. */
function buildInstructions(prompt: string, targetLanguage: string, pageIndex: number, pageCount: number): string {
  const lang = targetLanguage.trim() || 'English';
  return [
    `You are translating dialogue, captions and sound effects from a manga/manhwa page image into ${lang}.`,
    pageCount > 0 ? `This is page ${pageIndex + 1} of ${pageCount} in the current chapter — dialogue, captions or sound effects may continue from the previous page, so keep reading-order continuity in mind.` : '',
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

/** Provider-agnostic "send this image + these instructions, get raw text back" call — shared by
 *  `translatePageImage` (markup-mode text for the Text Editor's AI translation) and
 *  `aiTranslateBubbles.ts`/`aiPlaceBubbles.ts` (JSON-mode instructions for the Automation
 *  pipeline's bubble translator), so every consumer gets the same 9-provider support instead of
 *  each one hardcoding Gemini's own REST shape. */
export interface VisionCallParams {
  provider: AiProvider;
  apiKey: string;
  /** Falls back to the provider's default model when blank. */
  model: string;
  /** A `data:<mime>;base64,<data>` URL. */
  imageDataUrl: string;
  /** Full prompt text — caller builds this (markup instructions, JSON-schema instructions, etc.). */
  instructions: string;
  /** Only used by OpenAI-compatible providers — see `openAiCompatible` on AiProviderInfo. */
  baseUrl?: string;
}

async function callWithGemini({ apiKey, model, imageDataUrl, instructions }: VisionCallParams): Promise<string> {
  const { mimeType, base64 } = parseDataUrl(imageDataUrl);
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

/** Shared request builder for every provider that speaks the OpenAI `/chat/completions` shape
 *  (OpenAI itself, Ollama's OpenAI-compat endpoint, OpenRouter, Groq, Mistral, DeepSeek, xAI) —
 *  they differ only in base URL, default model and whether a key is required at all. */
async function callWithOpenAiCompatible({ apiKey, model, imageDataUrl, instructions, provider, baseUrl }: VisionCallParams): Promise<string> {
  const info = AI_PROVIDERS.find(p => p.id === provider);
  const resolvedBaseUrl = (baseUrl?.trim() || info?.defaultBaseUrl || '').replace(/\/+$/, '');
  if (!resolvedBaseUrl) throw new Error(`No base URL configured for ${info?.label ?? provider}.`);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${resolvedBaseUrl}/chat/completions`, {
    method: 'POST',
    headers,
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
  if (!res.ok) throw new Error(`${info?.label ?? provider} request failed (${res.status}): ${(await readErrorDetail(res)) || res.statusText}`);
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? '';
  return String(text).trim();
}

async function callWithAnthropic({ apiKey, model, imageDataUrl, instructions }: VisionCallParams): Promise<string> {
  const { mimeType, base64 } = parseDataUrl(imageDataUrl);
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

/** Sends one image + arbitrary instructions to the configured provider's vision API and returns
 *  raw text — the one place that knows how to reach each of the 9 providers. Callers own their own
 *  prompt format (markup for `translatePageImage`, JSON schema for the Automation pipeline's
 *  bubble/placement calls) and their own response parsing. */
export async function callVisionProvider(params: VisionCallParams): Promise<string> {
  const resolved: VisionCallParams = { ...params, model: params.model.trim() || defaultModelFor(params.provider) };
  switch (resolved.provider) {
    case 'gemini': return callWithGemini(resolved);
    case 'anthropic': return callWithAnthropic(resolved);
    case 'openai':
    case 'ollama':
    case 'openrouter':
    case 'groq':
    case 'mistral':
    case 'deepseek':
    case 'xai':
      return callWithOpenAiCompatible(resolved);
  }
}

/** Sends one manga page image to the configured provider's vision API and returns the translated
 *  markup text. Called directly from the browser with the user's own decrypted key — same
 *  client-side-call trust model this app already uses for Telegram (see aiSettingsStore.ts). */
export async function translatePageImage(params: TranslatePageParams): Promise<string> {
  const instructions = buildInstructions(params.prompt, params.targetLanguage, params.pageIndex, params.pageCount);
  return callVisionProvider({
    provider: params.provider, apiKey: params.apiKey, model: params.model,
    imageDataUrl: params.imageDataUrl, instructions, baseUrl: params.baseUrl,
  });
}
