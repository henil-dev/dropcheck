// Runs the pipeline after validation: logic layer -> prompt -> model -> checks -> confidence.
import { analyzeFunnel } from './funnel.js';
import { SYSTEM, RESPONSE_SCHEMA, buildPrompt, retryNote } from './prompt.js';
import { generate, modelName, llmConfigured } from './llm.js';
import { shape, review, scoreConfidence, ShapeError } from './review.js';

const issues = (c) => c.generic + c.unsupported;

export async function diagnose(input) {
  const logic = analyzeFunnel(input);
  const meta = { model: null, attempts: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0 };

  if (!logic.focus.length || !llmConfigured()) {
    return {
      logic,
      ai: null,
      status: 'logic_only',
      aiError: !logic.focus.length
        ? 'No step had enough data or stood out enough to diagnose, so the model was not called.'
        : 'The AI key (GEMINI_API_KEY) is not set on this server, so only the checks ran.',
      confidence: scoreConfidence(logic.dataQuality, null),
      meta,
    };
  }

  const focusNames = logic.focus.map((i) => logic.rows[i].name);
  const prompt = buildPrompt(input, logic);
  const turns = [{ role: 'user', text: prompt }];
  const started = Date.now();

  let best = null;
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    meta.attempts = attempt;
    let raw;
    try {
      raw = await generate({ system: SYSTEM, turns, schema: RESPONSE_SCHEMA });
    } catch (err) {
      lastError = err;
      break; // API-level failures already got a retry inside generate()
    }
    meta.model = raw.model;
    meta.tokensIn += raw.tokensIn;
    meta.tokensOut += raw.tokensOut;

    try {
      const ai = shape(raw.text, focusNames);
      const checks = review(ai, input, logic);
      // On a tie, prefer the later attempt: it has seen the feedback.
      if (!best || issues(checks) <= issues(best.checks)) best = { ai, checks };
      if (!checks.problems.length) break;
      turns.push({ role: 'model', text: raw.text }, { role: 'user', text: retryNote(checks.problems) });
    } catch (err) {
      if (!(err instanceof ShapeError)) throw err;
      lastError = err;
      turns.push({ role: 'model', text: raw.text }, { role: 'user', text: `${err.message} Return the full answer again as valid JSON matching the schema.` });
    }
  }
  meta.latencyMs = Date.now() - started;
  meta.model = meta.model || modelName();

  if (!best) {
    return {
      logic,
      ai: null,
      status: 'ai_error',
      aiError: lastError?.message || 'The model call failed.',
      confidence: scoreConfidence(logic.dataQuality, null),
      meta,
    };
  }

  return {
    logic,
    ai: best.ai,
    checks: { generic: best.checks.generic, unsupported: best.checks.unsupported, assumptions: best.checks.assumptions },
    status: 'ok',
    aiError: null,
    confidence: scoreConfidence(logic.dataQuality, best.ai, best.checks),
    meta,
  };
}
