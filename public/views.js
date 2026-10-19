// History, saved report and admin views. Used by the Node pages and the Claude-hosted page.
import { esc, when, int } from './util.js';
import { renderReport, wireFeedback } from './render.js';
import { listAnalyses, getAnalysis, adminStats, deleteAnalysis, reportHref, mode } from './api.js';

const STATUS = { ok: ['ok', 'Diagnosed'], logic_only: ['plain', 'Checks only'], ai_error: ['bad', 'AI failed'] };
const CONF = { High: 'ok', Medium: 'warn', Low: 'bad' };
const TYPES = { saas_signup: 'SaaS signup', ecommerce_checkout: 'E-commerce', mobile_onboarding: 'Mobile onboarding', lead_gen: 'Lead gen', other: 'Other' };
const shortId = (id) => String(id).slice(-6);

export async function renderHistory(box) {
  box.innerHTML = '<p class="muted" style="margin:0">Loading…</p>';
  let rows;
  try {
    rows = await listAnalyses();
  } catch (err) {
    box.innerHTML = `<div class="alert err" style="margin:0">${esc(err.message || 'Could not load history.')}</div>`;
    return;
  }
  if (!rows.length) {
    box.innerHTML = `<p style="margin:0">Nothing saved yet. <a href="${mode === 'server' ? '/' : '#new'}">Run your first analysis</a>.</p>`;
    return;
  }
  box.innerHTML = `<div class="scroll"><table class="data"><thead><tr><th>#</th><th>When</th><th>Funnel</th><th>Diagnosed steps</th><th>Result</th><th class="r">Confidence</th><th>Feedback</th></tr></thead><tbody>${rows
    .map((r) => `<tr>
      <td class="num muted">${esc(shortId(r.id))}</td>
      <td class="small nowrap">${when(r.created_at)}</td>
      <td><a href="${reportHref(r.id)}">${esc(r.funnel_name)}</a><div class="small muted">${r.step_count} steps</div></td>
      <td class="small">${esc(r.focus_steps || '—')}</td>
      <td><span class="chip ${STATUS[r.status][0]}">${STATUS[r.status][1]}</span></td>
      <td class="r nowrap">${r.confidence == null ? '—' : `<span class="num">${r.confidence}</span> <span class="chip ${CONF[r.confidence_label]}">${r.confidence_label}</span>`}</td>
      <td class="small">${r.feedback === 'useful' ? 'Useful' : r.feedback === 'not_useful' ? 'Not useful' : '<span class="muted">—</span>'}</td>
    </tr>`)
    .join('')}</tbody></table></div>`;
}

export async function renderSavedReport(box, id, { titleEl, metaEl } = {}) {
  box.innerHTML = '<p class="muted">Loading…</p>';
  const rec = await getAnalysis(id).catch(() => null);
  if (!rec) {
    box.innerHTML = '<div class="alert err">This analysis does not exist or could not be loaded.</div>';
    return;
  }
  if (titleEl) titleEl.textContent = rec.input.funnelName;
  if (metaEl) {
    metaEl.innerHTML = `Analysis #${esc(shortId(rec.id))} · ${when(rec.created_at)}${rec.meta?.model ? ` · ${esc(rec.meta.model)}` : ''}${rec.meta?.latencyMs ? ` · ${(rec.meta.latencyMs / 1000).toFixed(1)}s` : ''}`;
  }
  const changes = rec.input.recentChanges ? `<section class="block"><h2>Recent changes given</h2><p style="margin:0">${esc(rec.input.recentChanges)}</p></section>` : '';
  box.innerHTML = renderReport(rec) + changes;
  wireFeedback(box);
}

const stat = (v, k) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
const share = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

function hbars(items) {
  const max = Math.max(1, ...items.map((x) => x.n));
  return items.map((x) => `<div class="hbar"><span>${esc(x.label)}</span><span class="t"><i style="width:${(x.n / max) * 100}%"></i></span><span class="num r">${x.n}</span></div>`).join('');
}

function days(perDay) {
  const map = new Map(perDay.map((d) => [d.day, d]));
  const list = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    list.push(map.get(d) || { day: d, n: 0, errors: 0 });
  }
  const max = Math.max(1, ...list.map((d) => d.n));
  return `<div class="days">${list.map((d) => `<div class="d" title="${d.day}: ${d.n} analyses, ${d.errors} AI errors"><div class="b" style="height:${(d.n / max) * 100}%"><div class="e" style="height:${d.n ? (d.errors / d.n) * 100 : 0}%"></div></div></div>`).join('')}</div>
    <div class="days-lbl">${list.map((d, i) => `<span>${i % 2 ? '' : d.day.slice(8)}</span>`).join('')}</div>
    <p class="small muted" style="margin:8px 0 0">Last 14 days (UTC). Red part = runs where the AI step failed.</p>`;
}

export async function renderAdmin(box, subEl) {
  box.innerHTML = '<p class="muted">Loading…</p>';
  let s;
  try {
    s = await adminStats();
  } catch (err) {
    box.innerHTML = `<div class="alert err">${esc(err.message || 'Could not load stats.')}</div>`;
    return;
  }
  const t = s.totals;

  if (subEl) {
    const access = mode === 'server'
      ? (s.protected ? 'password protected' : '<span class="chip warn">open: set ADMIN_PASSWORD to protect</span>')
      : 'visible to editors of this page only';
    subEl.innerHTML = `Model: <span class="num">${esc(s.llm.model)}</span> · AI ${s.llm.configured ? '<span class="chip ok">available</span>' : '<span class="chip bad">not available</span>'} · ${access}`;
  }

  const costTile = t.costUsd == null
    ? stat('$0', "Model cost to you: each run uses the viewer's own Claude plan")
    : stat('$' + t.costUsd.toFixed(4), `Est. model cost · ${int(t.tokensIn + t.tokensOut)} tokens`);

  box.innerHTML = `
    <div class="stats">
      ${stat(int(t.total), 'Analyses')}
      ${stat(share(t.aiError, t.total), `AI failures (${t.aiError})`)}
      ${stat(t.avgConfidence ?? '—', 'Avg confidence')}
      ${stat(t.avgLatencyMs ? (t.avgLatencyMs / 1000).toFixed(1) + 's' : '—', 'Avg AI time')}
      ${stat(share(t.retried, t.ok), `Needed a retry (${t.retried})`)}
      ${stat(t.genericFlags + t.unsupportedFlags, `Lines flagged (${t.genericFlags} generic, ${t.unsupportedFlags} unsupported)`)}
      ${stat(share(t.useful, t.useful + t.notUseful), `Rated useful (${t.useful} of ${t.useful + t.notUseful})`)}
      ${costTile}
    </div>

    <section class="block"><h2>Analyses per day</h2>${days(s.perDay)}</section>

    <div class="two">
      <section class="block"><h2>Confidence</h2>
        ${hbars([{ label: 'High', n: s.confidence.high }, { label: 'Medium', n: s.confidence.medium }, { label: 'Low', n: s.confidence.low }])}
        <p class="small muted" style="margin:6px 0 0">Diagnosed runs only.</p>
      </section>
      <section class="block"><h2>Funnel types</h2>
        ${s.byType.length ? hbars(s.byType.map((x) => ({ label: TYPES[x.type] || x.type, n: x.n }))) : '<p class="muted" style="margin:0">No data yet.</p>'}
      </section>
      <section class="block"><h2>Rejected inputs <span class="muted num" style="font-weight:400">${t.rejections}</span></h2>
        ${s.topRejections.length ? `<ul class="small" style="margin:0;padding-left:18px">${s.topRejections.map((r) => `<li>${esc(r.reason)} <span class="muted">×${r.n}</span></li>`).join('')}</ul>` : '<p class="muted" style="margin:0">None.</p>'}
        <p class="small muted" style="margin:10px 0 0">Blocked by validation before any model call.</p>
      </section>
      <section class="block"><h2>Recent AI errors</h2>
        ${s.recentErrors.length ? `<ul class="small" style="margin:0;padding-left:18px">${s.recentErrors.map((e) => `<li><a href="${reportHref(e.id)}">#${esc(shortId(e.id))}</a> ${esc(e.error)} <span class="muted">${when(e.created_at)}</span></li>`).join('')}</ul>` : '<p class="muted" style="margin:0">None.</p>'}
      </section>
    </div>

    ${s.notUseful.length ? `<section class="block"><h2>Marked not useful</h2><ul class="small" style="margin:0;padding-left:18px">${s.notUseful.map((n) => `<li><a href="${reportHref(n.id)}">#${esc(shortId(n.id))} ${esc(n.funnel_name)}</a>${n.feedback_note ? `: "${esc(n.feedback_note)}"` : ''}</li>`).join('')}</ul></section>` : ''}

    <section class="block"><h2>Recent runs</h2>
      <div class="scroll"><table class="data small"><thead><tr><th>#</th><th>When</th><th>Funnel</th><th>Result</th><th class="r">Conf.</th><th class="r">Tries</th><th class="r">Flags</th><th class="r">Time</th><th></th></tr></thead>
      <tbody>${s.recent.map((r) => `<tr>
        <td class="num muted">${esc(shortId(r.id))}</td><td class="nowrap">${when(r.created_at)}</td>
        <td><a href="${reportHref(r.id)}">${esc(r.funnel_name)}</a></td>
        <td><span class="chip ${STATUS[r.status][0]}">${STATUS[r.status][1]}</span></td>
        <td class="r nowrap">${r.confidence ?? '—'}${r.confidence_label ? ` <span class="chip ${CONF[r.confidence_label]}">${r.confidence_label[0]}</span>` : ''}</td>
        <td class="r num">${r.attempts}</td>
        <td class="r num">${r.generic_flags + r.unsupported_flags}</td>
        <td class="r num">${r.latency_ms ? (r.latency_ms / 1000).toFixed(1) + 's' : '—'}</td>
        <td class="nowrap"><button type="button" class="del" data-id="${esc(r.id)}">Delete</button></td>
      </tr>`).join('') || '<tr><td colspan="9" class="muted">No runs yet.</td></tr>'}</tbody></table></div>
    </section>`;

  // Two-step delete: first click arms the button, second click deletes.
  box.querySelectorAll('button.del').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!b.dataset.armed) {
        b.dataset.armed = '1';
        b.textContent = 'Click again to delete';
        setTimeout(() => { delete b.dataset.armed; b.textContent = 'Delete'; }, 4000);
        return;
      }
      b.disabled = true;
      if (await deleteAnalysis(b.dataset.id).catch(() => false)) renderAdmin(box, subEl);
      else { b.disabled = false; b.textContent = 'Could not delete'; }
    })
  );
}
