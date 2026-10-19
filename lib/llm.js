// Thin wrapper over the Gemini REST API (no SDK, so it's easy to swap providers).
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 45000;
const FALLBACK_MODEL = 'gemini-flash-latest';

export class LlmError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export function llmConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function modelName() {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
}

async function call(model, { system, turns, schema }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((x) => ({ role: x.role, parts: [{ text: x.text }] })),
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      throw new LlmError(`Gemini API error: ${msg}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 });
    }

    const cand = body.candidates?.[0];
    const text = cand?.content?.parts?.map((x) => x.text || '').join('') || '';
    if (!text) {
      const why = cand?.finishReason || body.promptFeedback?.blockReason || 'empty response';
      throw new LlmError(`Gemini returned no text (${why}).`, { retryable: true });
    }
    return {
      text,
      model,
      finishReason: cand.finishReason,
      tokensIn: body.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: (body.usageMetadata?.candidatesTokenCount ?? 0) + (body.usageMetadata?.thoughtsTokenCount ?? 0),
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new LlmError(`Gemini did not answer within ${TIMEOUT_MS / 1000}s.`, { retryable: true });
    if (err instanceof LlmError) throw err;
    throw new LlmError(`Could not reach Gemini: ${err.message}`, { retryable: true });
  } finally {
    clearTimeout(t);
  }
}

// Adapter shape expected by lib/diagnose.js.
export const gemini = {
  get name() { return modelName(); },
  get configured() { return llmConfigured(); },
  missingNote: 'The AI key (GEMINI_API_KEY) is not set on this server, so only the checks ran.',
  generate: (req) => generate(req),
};

export async function generate(req) {
  if (!llmConfigured()) throw new LlmError('GEMINI_API_KEY is not set on the server.');
  const model = modelName();
  try {
    return await call(model, req);
  } catch (err) {
    // Model names get retired; fall back to Google's rolling alias instead of failing.
    if (err.status === 404 && model !== FALLBACK_MODEL) return call(FALLBACK_MODEL, req);
    if (err.retryable) {
      await new Promise((r) => setTimeout(r, 1200));
      return call(model, req);
    }
    throw err;
  }
}
