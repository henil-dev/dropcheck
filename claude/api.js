// Backend for the Claude-hosted page. Same exports as public/api.js, but nothing leaves the page:
// validation and the logic layer run here, Claude is the LLM (the `sample` capability),
// and analyses are stored in the page's own database (the `db` capability).
import { validateFunnel } from './lib/validate.js';
import { diagnose } from './lib/diagnose.js';
import { JSON_FORMAT } from './lib/prompt.js';

export const mode = 'claude';
export const reportHref = (id) => `#report-${id}`;

// claude.use() resolves null when this view can't run a capability (signed out, not granted, outside claude.ai).
const use = (name) => (window.claude?.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null));
const sampleP = use('sample');
const dbP = use('db');
const userP = use('user');

const SAMPLE_ERRORS = {
  not_granted: 'You did not allow this page to use Claude, so only the checks ran. Reload the page to be asked again.',
  sampling_disabled: 'Claude is not available on this account, so only the checks ran.',
  rate_limited: 'Claude usage limit reached for now. The checks below still ran; try the AI step again later.',
  session_expired: 'Your Claude session expired. Sign in again and rerun.',
  refused: 'Claude declined this input. Try rewording the step descriptions.',
  empty_completion: 'Claude returned an empty answer. Try again.',
  prompt_too_large: 'The funnel description is too long for one request. Shorten the step descriptions.',
};

// Adapter shape expected by lib/diagnose.js.
async function claudeAdapter() {
  const sample = await sampleP;
  return {
    name: 'Claude',
    configured: Boolean(sample),
    missingNote: 'Claude is not available in this view (open the page on claude.ai while signed in), so only the checks ran.',
    async generate({ system, turns }) {
      // No system role here: the rules and output format ride in the first user turn.
      const messages = turns.map((t, i) => ({
        role: t.role === 'model' ? 'assistant' : 'user',
        content: i === 0 ? `${system}\n\n${JSON_FORMAT}\n\n${t.text}` : t.text,
      }));
      try {
        const r = await sample(messages, { modelTier: 'default' });
        return { text: r.text, model: `Claude (${r.modelTierApplied} tier)`, tokensIn: 0, tokensOut: 0 };
      } catch (e) {
        throw new Error(SAMPLE_ERRORS[e?.code] || `Claude call failed (${e?.code || 'unknown error'}).`);
      }
    },
  };
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function requireDb() {
  const db = await dbP;
  if (!db) throw new Error('Saved analyses are only available when this page is opened on claude.ai while signed in.');
  return db;
}

export async function analyze(body) {
  const v = validateFunnel(body);
  const db = await dbP;

  if (!v.ok) {
    if (db) {
      db.collection('rejections').doc(newId())
        .set({ created_at: new Date().toISOString(), error_count: v.errors.length, first_error: v.errors[0]?.message ?? null })
        .catch(() => {});
    }
    return { ok: false, data: { error: 'Please fix the highlighted fields.', errors: v.errors, warnings: v.warnings } };
  }

  const result = await diagnose(v.data, await claudeAdapter());
  const { logic, confidence, meta, checks } = result;
  const row = {
    created_at: new Date().toISOString(),
    funnel_name: v.data.funnelName,
    funnel_type: v.data.funnelType,
    step_count: v.data.steps.length,
    focus_steps: logic.focus.map((i) => logic.rows[i].name).join(', '),
    status: result.status,
    error: result.aiError,
    confidence: confidence?.score ?? null,
    confidence_label: confidence?.label ?? null,
    model: meta.model,
    attempts: meta.attempts,
    generic_flags: checks?.generic ?? 0,
    unsupported_flags: checks?.unsupported ?? 0,
    latency_ms: meta.latencyMs,
    feedback: null,
    feedback_note: null,
    input: v.data,
    result: { warnings: v.warnings, ...result },
  };

  let id = null;
  let saveNote = null;
  if (!db) {
    saveNote = 'This run was not saved: history is only kept when the page is opened on claude.ai while signed in.';
  } else {
    const docId = newId();
    try {
      await db.collection('analyses').doc(docId).set(row);
      id = docId;
    } catch (e) {
      saveNote = e?.code === 'invalid_argument'
        ? 'This run was not saved: your access to this page is view-only. Ask the owner for Contributor access to keep history.'
        : 'This run could not be saved. The report below is still complete.';
    }
  }
  return { ok: true, data: { id, input: v.data, warnings: v.warnings, saveNote, ...result } };
}

function summary(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    created_at: d.created_at,
    funnel_name: d.funnel_name,
    funnel_type: d.funnel_type,
    step_count: d.step_count,
    focus_steps: d.focus_steps,
    status: d.status,
    error: d.error,
    confidence: d.confidence,
    confidence_label: d.confidence_label,
    model: d.model,
    attempts: d.attempts,
    generic_flags: d.generic_flags,
    unsupported_flags: d.unsupported_flags,
    latency_ms: d.latency_ms,
    feedback: d.feedback,
    feedback_note: d.feedback_note,
  };
}

async function allRows(limit = 500) {
  const db = await requireDb();
  const snap = await db.collection('analyses').orderBy('created_at', 'desc').limit(limit).get();
  return snap.docs.map(summary);
}

export const listAnalyses = () => allRows(200);

export async function getAnalysis(id) {
  const db = await requireDb();
  const snap = await db.doc(`analyses/${id}`).get();
  if (!snap.exists) return null;
  const { input, result, ...rest } = snap.data();
  return { ...rest, id: snap.id, input, ...result };
}

export async function sendFeedback(id, feedback, note) {
  const db = await requireDb();
  await db.doc(`analyses/${id}`).update({ feedback, feedback_note: note ? String(note).trim().slice(0, 500) : null });
  return true;
}

export async function deleteAnalysis(id) {
  const db = await requireDb();
  await db.doc(`analyses/${id}`).delete();
  return true;
}

export async function canSeeAdmin() {
  const user = await userP;
  return Boolean(user && (await user.canEdit().catch(() => false)));
}

// Same shape as lib/stats.js on the server, computed from the stored rows.
export async function adminStats() {
  const rows = await allRows(1000);
  const db = await requireDb();
  const rej = (await db.collection('rejections').limit(1000).get()).docs.map((d) => d.data());

  const ok = rows.filter((r) => r.status === 'ok');
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const count = (xs, f) => xs.filter(f).length;
  const tally = (xs, key) => {
    const m = new Map();
    for (const x of xs) m.set(key(x), (m.get(key(x)) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const since = new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10);
  const perDay = tally(rows.filter((r) => r.created_at.slice(0, 10) >= since), (r) => r.created_at.slice(0, 10)).map(([day, n]) => ({
    day,
    n,
    errors: count(rows, (r) => r.created_at.slice(0, 10) === day && r.status === 'ai_error'),
  }));

  return {
    totals: {
      total: rows.length,
      ok: ok.length,
      logicOnly: count(rows, (r) => r.status === 'logic_only'),
      aiError: count(rows, (r) => r.status === 'ai_error'),
      avgConfidence: avg(ok.map((r) => r.confidence).filter((x) => x != null)),
      avgLatencyMs: avg(ok.map((r) => r.latency_ms).filter(Boolean)),
      retried: count(ok, (r) => r.attempts > 1),
      genericFlags: rows.reduce((a, r) => a + (r.generic_flags || 0), 0),
      unsupportedFlags: rows.reduce((a, r) => a + (r.unsupported_flags || 0), 0),
      tokensIn: 0,
      tokensOut: 0,
      costUsd: null,
      useful: count(rows, (r) => r.feedback === 'useful'),
      notUseful: count(rows, (r) => r.feedback === 'not_useful'),
      rejections: rej.length,
    },
    confidence: {
      high: count(ok, (r) => r.confidence_label === 'High'),
      medium: count(ok, (r) => r.confidence_label === 'Medium'),
      low: count(ok, (r) => r.confidence_label === 'Low'),
    },
    perDay,
    byType: tally(rows, (r) => r.funnel_type).map(([type, n]) => ({ type, n })),
    topRejections: tally(rej, (r) => r.first_error).slice(0, 5).map(([reason, n]) => ({ reason, n })),
    recentErrors: rows.filter((r) => r.status === 'ai_error').slice(0, 5).map(({ id, created_at, error }) => ({ id, created_at, error })),
    notUseful: rows.filter((r) => r.feedback === 'not_useful').slice(0, 5).map(({ id, funnel_name, feedback_note }) => ({ id, funnel_name, feedback_note })),
    recent: rows.slice(0, 25),
    llm: { configured: Boolean(await sampleP), model: 'Claude (via claude.ai)' },
    protected: true,
  };
}
