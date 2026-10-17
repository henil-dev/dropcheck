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

export function renderReport(rec) {
  const { logic } = rec;
  return `
    <section class="block">
      <div class="block-head"><h2>Funnel</h2><span class="muted small">${esc(rec.input.funnelName)} · ${rec.input.periodDays} days</span></div>
      ${funnelTable(logic)}
    </section>
    <section class="block">
      <h2>What the checks found</h2>
      <p class="muted small" style="margin:-6px 0 14px">Calculated by code before any AI is involved.</p>
      ${checks(logic)}
      ${sizing(logic.sizing)}
    </section>`;
}
