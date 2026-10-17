import { esc, pct, int } from '/util.js';

const FLAG = {
  regression: ['bad', 'Real drop vs last period'],
  outlier: ['bad', 'Much lower than other steps'],
  not_significant: ['warn', 'Lower, but could be noise'],
  low_sample: ['warn', 'Too few users to judge'],
  biggest_leak: ['plain', 'Most users lost here'],
};

const chip = (kind, text) => `<span class="chip ${kind}">${esc(text)}</span>`;

function delta(r) {
  if (r.deltaPp === null) return '<span class="muted">—</span>';
  const cls = r.deltaPp < 0 ? 'delta-down' : 'delta-up';
  return `<span class="num ${cls}">${r.deltaPp > 0 ? '+' : ''}${r.deltaPp.toFixed(1)} pts</span>`;
}

function funnelTable(logic) {
  const max = logic.rows[0].users || 1;
  const rows = logic.rows
    .map((r) => {
      const flagged = r.flags.includes('regression') || r.flags.includes('outlier');
      return `<tr>
        <td><strong>${esc(r.name)}</strong>
          <div class="bar ${flagged ? 'flag' : ''}" style="width:${Math.max(1, (r.users / max) * 100)}%"></div></td>
        <td class="r num">${int(r.users)}</td>
        <td class="r num">${r.index === 0 ? '<span class="muted">start</span>' : pct(r.conversion)}</td>
        <td class="r num">${r.baseline === null ? '<span class="muted">—</span>' : pct(r.baseline)}</td>
        <td class="r">${delta(r)}</td>
        <td>${r.flags.map((f) => chip(...FLAG[f])).join('')}</td>
      </tr>`;
    })
    .join('');
  return `<table class="data">
    <thead><tr><th>Step</th><th class="r">Users</th><th class="r">Step conv.</th><th class="r">Last period</th><th class="r">Change</th><th>Flags</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="muted small" style="margin:12px 0 0">Overall: <span class="num">${pct(logic.overall, 2)}</span> of users reach the last step. ${int(logic.totalLost)} users lost in total.</p>`;
}

function checkLine(r, logic) {
  const t = logic.thresholds;
  const out = [];
  if (r.flags.includes('regression')) {
    out.push(`Converts at <b class="num">${pct(r.conversion)}</b> vs <b class="num">${pct(r.baseline)}</b> last period (${r.deltaPp.toFixed(1)} pts, z = ${r.z}). With ${int(r.entered)} users that is very unlikely to be chance.`);
  } else if (r.flags.includes('outlier')) {
    out.push(`Converts at <b class="num">${pct(r.conversion)}</b> while the other steps' median is <b class="num">${pct(r.medianOthers)}</b> (gap over ${t.OUTLIER_GAP_PP} pts).`);
  } else if (r.flags.includes('not_significant')) {
    out.push(`Down ${Math.abs(r.deltaPp).toFixed(1)} pts, but z = ${r.z} is below ${t.Z_SIGNIFICANT}, so this may be normal variation.`);
  } else if (r.flags.includes('biggest_leak')) {
    out.push(`No abnormal change, but this step loses the most users (${pct(r.lostShare, 0)} of all drop-off).`);
  }
  if (r.flags.includes('low_sample')) out.push(`Only ${int(r.entered)} users reached this step (under ${t.LOW_SAMPLE}), so it is not judged.`);
  return out;
}

function checks(logic) {
  const items = logic.rows
    .filter((r) => r.index > 0)
    .map((r) => {
      const lines = checkLine(r, logic);
      const extras = [];
      if (r.signals.length) extras.push(`<div class="small muted" style="margin-top:4px">Friction in description: ${r.signals.map((s) => chip('plain', s.label)).join('')}</div>`);
      if (r.relatedChanges.length) extras.push(`<div class="small" style="margin-top:4px">Recent change that mentions this step: <i>"${esc(r.relatedChanges.join(' '))}"</i></div>`);
      if (!lines.length && !extras.length) return '';
      return `<li style="margin-bottom:12px"><strong>${esc(r.name)}</strong>${lines.length ? ': ' + lines.join(' ') : ''}${extras.join('')}</li>`;
    })
    .filter(Boolean)
    .join('');

  const focusNames = logic.focus.map((i) => logic.rows[i].name);
  const why = {
    regression: 'the biggest real drops compared with last period',
    outlier: 'converts far below the rest of the funnel',
    biggest_leak: 'nothing changed abnormally, so the step losing the most users',
  }[logic.focusReason];

  return `<ul style="padding-left:18px;margin:0 0 10px">${items || '<li class="muted">Nothing unusual found.</li>'}</ul>
    ${focusNames.length
      ? `<p style="margin:0">Sent to diagnosis: <strong>${focusNames.map(esc).join(', ')}</strong> (${why}).</p>`
      : `<p style="margin:0" class="muted">No step had enough data to diagnose.</p>`}`;
}

function sizing(s) {
  if (!s) return '';
  return `<p class="small" style="margin:10px 0 0">To detect <span class="num">${pct(s.from)} → ${pct(s.to)}</span> (${esc(s.basis)}) at 95% confidence and 80% power:
    <b class="num">${int(s.perVariant)}</b> users per variant, about <b class="num">${s.days ?? '—'}</b> ${s.days === 1 ? 'day' : 'days'} at ${int(s.dailyTraffic)} users/day.
    ${s.tooLong ? '<span class="chip warn">Longer than 6 weeks: test a bigger change or a higher-traffic step</span>' : ''}</p>`;
}

function confidenceBlock(c) {
  const kind = c.label === 'High' ? 'ok' : c.label === 'Medium' ? 'warn' : 'bad';
  const rows = [
    ...c.parts.map((p) => `<tr><td>${esc(p.label)}</td><td class="r num">${p.value}</td></tr>`),
    ...(c.penalties || []).map((p) => `<tr><td>${esc(p.label)}</td><td class="r num delta-down">${p.value}</td></tr>`),
  ].join('');
  const notes = c.notes.length
    ? `<p class="small muted" style="margin:10px 0 0">Data quality lost points for: ${c.notes.map((n) => `${esc(n.text)} (${n.delta})`).join('; ')}.</p>`
    : '';
  return `<section class="block">
    <div class="block-head"><h2>Confidence</h2><span class="chip ${kind}">${c.label}</span></div>
    <div style="display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap">
      <div class="num" style="font-size:44px;line-height:1;font-weight:600">${c.score}<span class="muted" style="font-size:18px">/100</span></div>
      <div style="flex:1;min-width:240px">
        <table class="data small"><tbody>${rows}</tbody></table>
        <p class="small muted" style="margin:6px 0 0">Score = the lower of the two numbers above, minus penalties from the answer checks.</p>
      </div>
    </div>${notes}
  </section>`;
}

function checkChips(c = {}) {
  return `${c.generic ? chip('bad', 'Generic') : ''}${c.unsupported ? chip('bad', 'Evidence not found in input') : ''}`;
}

function diagnosis(ai) {
  return ai.diagnoses
    .map(
      (d) => `<section class="block">
      <h2>${esc(d.step)}</h2>
      <h3>Likely reasons</h3>
      <ol style="padding-left:20px;margin:0 0 18px">
        ${d.reasons
          .map(
            (r) => `<li style="margin-bottom:10px">${esc(r.text)} ${r.kind === 'assumption' ? chip('warn', 'Assumption') : ''}${checkChips(r.checks)}
            ${r.evidence ? `<div class="small muted">${r.kind === 'assumption' ? 'To confirm' : 'Based on'}: "${esc(r.evidence)}"</div>` : ''}</li>`
          )
          .join('')}
      </ol>
      <h3>Hypotheses to test</h3>
      <ol style="padding-left:20px;margin:0">
        ${d.hypotheses
          .map(
            (h) => `<li style="margin-bottom:10px">${esc(h.statement)} ${checkChips(h.checks)}
            <div class="small muted">Change: ${esc(h.change)} · Measure: ${esc(h.metric)}</div></li>`
          )
          .join('')}
      </ol>
    </section>`
    )
    .join('');
}

function experiment(e, s) {
  const row = (k, v) => (v ? `<tr><td class="muted" style="width:150px">${k}</td><td>${esc(v)}</td></tr>` : '');
  const size =
    s && s.step === e.step && s.perVariant
      ? `<tr><td class="muted">Sample size</td><td><span class="num">${int(s.perVariant)}</span> per variant, about <span class="num">${s.days}</span> ${s.days === 1 ? 'day' : 'days'} at current traffic (calculated, not from the model)</td></tr>`
      : '';
  return `<section class="block" style="border-color:var(--ink)">
    <div class="block-head"><h2>Run this first</h2><span class="muted small">${esc(e.step)}</span></div>
    <p style="margin:0 0 14px;font-size:17px;font-weight:500">${esc(e.title)}</p>
    <table class="data"><tbody>
      ${row('Control', e.control)}${row('Variant', e.variant)}${row('Primary metric', e.primary_metric)}${row('Guardrail', e.guardrail_metric)}${size}${row('Why this one', e.why_first)}
    </tbody></table>
  </section>`;
}

export function renderReport(rec) {
  const { logic, ai } = rec;
  const notice =
    rec.status === 'ok'
      ? ''
      : `<div class="alert ${rec.status === 'ai_error' ? 'err' : 'info'}"><strong>${rec.status === 'ai_error' ? 'The AI step failed, so this is the logic-layer report only.' : 'Logic-layer report only.'}</strong><div class="small">${esc(rec.aiError || '')}</div></div>`;

  const part = (n, t, sub) => `<div class="part"><span class="num">${n}</span> ${t} <span class="muted">${sub}</span></div>`;

  return `${notice}
    ${part('01', 'Checks', 'calculated by code, before any AI')}
    <section class="block">
      <div class="block-head"><h2>Funnel</h2><span class="muted small">${esc(rec.input.funnelName)} · ${rec.input.periodDays} days</span></div>
      ${funnelTable(logic)}
    </section>
    <section class="block">
      <h2>What the checks found</h2>
      ${checks(logic)}
      ${sizing(logic.sizing)}
    </section>
    ${ai ? part('02', 'Diagnosis', `from ${esc(rec.meta?.model || 'the model')}, then checked by code`) : ''}
    ${ai?.summary ? `<section class="block"><h2>Summary</h2><p style="margin:0;font-size:16px">${esc(ai.summary)}</p></section>` : ''}
    ${rec.confidence ? confidenceBlock(rec.confidence) : ''}
    ${ai ? experiment(ai.experiment, logic.sizing) : ''}
    ${ai ? diagnosis(ai) : ''}
    ${ai?.missing_info?.length ? `<section class="block"><h2>Data that would sharpen this</h2><ul style="margin:0;padding-left:18px">${ai.missing_info.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>${ai.confidence_reason ? `<p class="small muted" style="margin:10px 0 0">Model's note on confidence: ${esc(ai.confidence_reason)}</p>` : ''}</section>` : ''}`;
}
