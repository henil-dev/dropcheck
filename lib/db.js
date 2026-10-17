import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = process.env.DB_PATH || path.join(root, 'data', 'dropcheck.db');
mkdirSync(path.dirname(file), { recursive: true });

const db = new Database(file);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    funnel_name TEXT NOT NULL,
    funnel_type TEXT NOT NULL,
    step_count INTEGER NOT NULL,
    focus_steps TEXT,
    status TEXT NOT NULL,              -- ok | logic_only | ai_error
    error TEXT,
    confidence INTEGER,
    confidence_label TEXT,
    model TEXT,
    attempts INTEGER DEFAULT 0,
    generic_flags INTEGER DEFAULT 0,
    unsupported_flags INTEGER DEFAULT 0,
    latency_ms INTEGER DEFAULT 0,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    feedback TEXT,                     -- useful | not_useful
    feedback_note TEXT,
    input_json TEXT NOT NULL,
    result_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rejections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    error_count INTEGER NOT NULL,
    first_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_analyses_created ON analyses(created_at);
`);

const insert = db.prepare(`
  INSERT INTO analyses (funnel_name, funnel_type, step_count, focus_steps, status, error, confidence, confidence_label,
    model, attempts, generic_flags, unsupported_flags, latency_ms, tokens_in, tokens_out, input_json, result_json)
  VALUES (@funnel_name, @funnel_type, @step_count, @focus_steps, @status, @error, @confidence, @confidence_label,
    @model, @attempts, @generic_flags, @unsupported_flags, @latency_ms, @tokens_in, @tokens_out, @input_json, @result_json)
`);

export function saveAnalysis(input, warnings, result) {
  const { logic, confidence, meta, checks } = result;
  const info = insert.run({
    funnel_name: input.funnelName,
    funnel_type: input.funnelType,
    step_count: input.steps.length,
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
    tokens_in: meta.tokensIn,
    tokens_out: meta.tokensOut,
    input_json: JSON.stringify(input),
    result_json: JSON.stringify({ warnings, ...result }),
  });
  return Number(info.lastInsertRowid);
}

export function logRejection(errors) {
  db.prepare('INSERT INTO rejections (error_count, first_error) VALUES (?, ?)').run(errors.length, errors[0]?.message ?? null);
}

export function listAnalyses(limit = 100) {
  return db
    .prepare(
      `SELECT id, created_at, funnel_name, funnel_type, step_count, focus_steps, status, confidence, confidence_label, feedback
       FROM analyses ORDER BY id DESC LIMIT ?`
    )
    .all(limit);
}

export function getAnalysis(id) {
  const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(id);
  if (!row) return null;
  const { input_json, result_json, ...rest } = row;
  return { ...rest, input: JSON.parse(input_json), ...JSON.parse(result_json) };
}

export function setFeedback(id, feedback, note) {
  return db.prepare('UPDATE analyses SET feedback = ?, feedback_note = ? WHERE id = ?').run(feedback, note || null, id).changes > 0;
}

export function deleteAnalysis(id) {
  return db.prepare('DELETE FROM analyses WHERE id = ?').run(id).changes > 0;
}

export { db };
