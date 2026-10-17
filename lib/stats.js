import { db } from './db.js';

// USD per 1M tokens. Defaults are Gemini 2.5 Flash list prices; override if the model changes.
const PRICE_IN = Number(process.env.PRICE_IN_PER_M || 0.3);
const PRICE_OUT = Number(process.env.PRICE_OUT_PER_M || 2.5);

export function adminStats() {
  const t = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(status = 'ok') AS ok,
        SUM(status = 'logic_only') AS logic_only,
        SUM(status = 'ai_error') AS ai_error,
        ROUND(AVG(CASE WHEN status = 'ok' THEN confidence END)) AS avg_confidence,
        ROUND(AVG(CASE WHEN status = 'ok' THEN latency_ms END)) AS avg_latency,
        SUM(attempts > 1) AS retried,
        SUM(generic_flags) AS generic_flags,
        SUM(unsupported_flags) AS unsupported_flags,
        SUM(tokens_in) AS tokens_in,
        SUM(tokens_out) AS tokens_out,
        SUM(feedback = 'useful') AS useful,
        SUM(feedback = 'not_useful') AS not_useful,
        SUM(confidence_label = 'High' AND status = 'ok') AS c_high,
        SUM(confidence_label = 'Medium' AND status = 'ok') AS c_med,
        SUM(confidence_label = 'Low' AND status = 'ok') AS c_low
      FROM analyses`
    )
    .get();

  const zero = (v) => v ?? 0;
  const cost = (zero(t.tokens_in) * PRICE_IN + zero(t.tokens_out) * PRICE_OUT) / 1e6;

  const perDay = db
    .prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS n, SUM(status = 'ai_error') AS errors
       FROM analyses WHERE created_at >= datetime('now', '-13 days') GROUP BY day ORDER BY day`
    )
    .all();

  const rejections = db.prepare('SELECT COUNT(*) AS n FROM rejections').get().n;
  const topRejections = db
    .prepare(
      `SELECT first_error AS reason, COUNT(*) AS n FROM rejections GROUP BY first_error ORDER BY n DESC LIMIT 5`
    )
    .all();

  const byType = db.prepare('SELECT funnel_type AS type, COUNT(*) AS n FROM analyses GROUP BY funnel_type ORDER BY n DESC').all();

  const recentErrors = db
    .prepare(`SELECT id, created_at, error FROM analyses WHERE status = 'ai_error' ORDER BY id DESC LIMIT 5`)
    .all();

  const notUseful = db
    .prepare(`SELECT id, funnel_name, feedback_note FROM analyses WHERE feedback = 'not_useful' ORDER BY id DESC LIMIT 5`)
    .all();

  const recent = db
    .prepare(
      `SELECT id, created_at, funnel_name, status, confidence, confidence_label, attempts, generic_flags, unsupported_flags,
              latency_ms, tokens_in + tokens_out AS tokens, model, feedback
       FROM analyses ORDER BY id DESC LIMIT 25`
    )
    .all();

  return {
    totals: {
      total: zero(t.total),
      ok: zero(t.ok),
      logicOnly: zero(t.logic_only),
      aiError: zero(t.ai_error),
      avgConfidence: t.avg_confidence,
      avgLatencyMs: t.avg_latency,
      retried: zero(t.retried),
      genericFlags: zero(t.generic_flags),
      unsupportedFlags: zero(t.unsupported_flags),
      tokensIn: zero(t.tokens_in),
      tokensOut: zero(t.tokens_out),
      costUsd: Math.round(cost * 10000) / 10000,
      useful: zero(t.useful),
      notUseful: zero(t.not_useful),
      rejections,
    },
    confidence: { high: zero(t.c_high), medium: zero(t.c_med), low: zero(t.c_low) },
    perDay,
    byType,
    topRejections,
    recentErrors,
    notUseful,
    recent,
  };
}
