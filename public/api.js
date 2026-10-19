// Backend for the Node version: talks to server.js over HTTP.
// The Claude-hosted page ships its own api.js with the same exports (see claude/api.js).

async function json(res) {
  return res.json().catch(() => ({ error: 'The server sent back something unexpected.' }));
}

export const mode = 'server';
export const reportHref = (id) => `/report?id=${encodeURIComponent(id)}`;

export async function analyze(body) {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await json(res) };
}

export async function listAnalyses() {
  const res = await fetch('/api/analyses');
  if (!res.ok) throw new Error('Could not load history.');
  return res.json();
}

export async function getAnalysis(id) {
  const res = await fetch(`/api/analyses/${encodeURIComponent(id)}`);
  return res.ok ? res.json() : null;
}

export async function sendFeedback(id, feedback, note) {
  const res = await fetch(`/api/analyses/${encodeURIComponent(id)}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback, note }),
  });
  return res.ok;
}

export async function adminStats() {
  const res = await fetch('/api/admin/stats');
  if (!res.ok) throw new Error('Could not load stats.');
  return res.json();
}

export async function deleteAnalysis(id) {
  const res = await fetch(`/api/admin/analyses/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res.ok;
}
