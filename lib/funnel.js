// Logic layer. Everything here runs before the model is called and is
// deterministic: the model never does arithmetic, it only gets these results.

const LOW_SAMPLE = 100; // users entering a step; below this, a drop is too noisy to judge
const MIN_DROP_PP = 3; // a regression has to be at least this many points worse than baseline
const Z_SIGNIFICANT = 1.96; // ~95% two-sided
const OUTLIER_GAP_PP = 15; // no baseline: step converts this far below the other steps' median
const MAX_FOCUS = 2;

// Friction patterns we look for in step descriptions. Kept short on purpose:
// these are hints for the model and the user, not a diagnosis by themselves.
const SIGNALS = [
  { key: 'payment', label: 'Asks for payment', re: /credit card|card details|\bcard\b|payment|billing|\bpay\b|paywall|checkout/i },
  { key: 'identity', label: 'Identity / phone check', re: /phone|\botp\b|\bsms\b|verify|verification|\bkyc\b|id proof|document upload/i },
  { key: 'email_confirm', label: 'Waits on an email', re: /confirm(ation)? email|verification email|email link|click (the )?link|check (your )?inbox/i },
  { key: 'form_length', label: 'Long form or many screens', re: /\b([4-9]|\d{2,})\s*(fields|questions|screens|steps|pages)\b|\bwizard\b/i },
  { key: 'required', label: 'Something is required', re: /\brequired\b|mandatory|\bmust\b|cannot skip|can't skip|no skip/i },
  { key: 'account', label: 'Account creation', re: /sign ?up|create (an )?account|register|password/i },
  { key: 'invite', label: 'Asks to invite others', re: /invite|teammates|refer a friend|share with/i },
  { key: 'integration', label: 'Needs an integration or install', re: /connect\b|integrat|install|import|\bsync\b|download/i },
  { key: 'permissions', label: 'Permission prompt', re: /permission|allow (access|notifications)|location access|camera|microphone/i },
  { key: 'pricing', label: 'Shows price or costs', re: /\bprice|pricing|\bplans?\b|shipping|\bfee\b|\btax\b|coupon|discount/i },
  { key: 'speed', label: 'Possible slowness', re: /load(ing)? time|slow|spinner|takes \d+ ?s/i },
];

const STOP = new Set(
  'the a an and or of to in on at for with from by is are was were be this that it its as we our you your they them their user users step page screen new now only all any after before into than then also more most less very just have has had not no can will would should could may might each per'.split(' ')
);

export function words(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 4 && !STOP.has(w));
}

const round = (x, d = 4) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Users needed per variant to detect p1 -> p2 (two-sided 5%, 80% power).
export function sampleSizePerVariant(p1, p2) {
  if (!(p1 > 0 && p1 < 1 && p2 > 0 && p2 < 1) || p1 === p2) return null;
  const za = 1.96;
  const zb = 0.8416;
  const pbar = (p1 + p2) / 2;
  const n = (za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p2 - p1) ** 2;
  return Math.ceil(n);
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

// Link "recent changes" sentences to the step they most likely touch.
function linkChanges(steps, recentChanges) {
  const sentences = splitSentences(recentChanges);
  return steps.map((s) => sentences.filter((sent) => sharesKeyTerm(sent, s)));
}

// Avoid linking on one weak, common word: require either a step-name word or two shared words.
function sharesKeyTerm(sentence, step) {
  const sw = words(sentence);
  const nameWords = new Set(words(step.name));
  if (sw.some((w) => nameWords.has(w))) return true;
  const descWords = new Set(words(step.description));
  return sw.filter((w) => descWords.has(w)).length >= 2;
}

export function analyzeFunnel(input) {
  const { steps, periodDays, recentChanges } = input;
  const linked = linkChanges(steps, recentChanges);
  const top = steps[0].users;

  const rows = steps.map((s, i) => {
    const row = {
      index: i,
      name: s.name,
      description: s.description,
      users: s.users,
      ofTop: top ? s.users / top : 0,
      conversion: null,
      lost: 0,
      baseline: null,
      deltaPp: null,
      z: null,
      flags: [],
      signals: SIGNALS.filter((x) => x.re.test(s.description)).map(({ key, label }) => ({ key, label })),
      relatedChanges: linked[i],
    };
    if (i === 0) return row;

    const prev = steps[i - 1].users;
    row.entered = prev;
    row.conversion = prev ? s.users / prev : 0;
    row.lost = prev - s.users;

    if (prev < LOW_SAMPLE) row.flags.push('low_sample');

    if (s.baselineRate !== null) {
      const b = s.baselineRate / 100;
      row.baseline = b;
      row.deltaPp = (row.conversion - b) * 100;
      if (b > 0 && b < 1 && prev > 0) {
        const se = Math.sqrt((b * (1 - b)) / prev);
        row.z = (b - row.conversion) / se;
      }
      if (prev >= LOW_SAMPLE && row.deltaPp <= -MIN_DROP_PP && row.z !== null && row.z >= Z_SIGNIFICANT) {
        row.flags.push('regression');
        const relative = b > 0 ? -row.deltaPp / (b * 100) : 0;
        row.severity = row.deltaPp <= -8 || relative >= 0.15 ? 'high' : 'medium';
      } else if (row.deltaPp !== null && row.deltaPp <= -MIN_DROP_PP) {
        row.flags.push('not_significant');
      }
    }
    return row;
  });

  // Steps without a baseline: compare with the rest of this funnel.
  for (const r of rows.slice(1)) {
    if (r.baseline !== null || r.flags.includes('low_sample')) continue;
    const others = rows.slice(1).filter((x) => x !== r).map((x) => x.conversion);
    const med = median(others);
    if (med !== null && others.length >= 2 && (med - r.conversion) * 100 >= OUTLIER_GAP_PP) {
      r.flags.push('outlier');
      r.medianOthers = med;
      r.severity = (med - r.conversion) * 100 >= 25 ? 'high' : 'medium';
    }
  }

  const totalLost = rows.reduce((a, r) => a + r.lost, 0);
  for (const r of rows) r.lostShare = totalLost ? r.lost / totalLost : 0;
  const biggest = rows.slice(1).reduce((a, r) => (r.lost > (a?.lost ?? -1) ? r : a), null);
  if (biggest && biggest.lost > 0) biggest.flags.push('biggest_leak');

  // Which steps go to the model: regressions first, then outliers, ranked by users lost.
  const sevRank = { high: 2, medium: 1 };
  const byImpact = (a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0) || b.lost - a.lost;
  let focus = rows.filter((r) => r.flags.includes('regression')).sort(byImpact);
  let focusReason = 'regression';
  if (!focus.length) {
    focus = rows.filter((r) => r.flags.includes('outlier')).sort(byImpact);
    focusReason = 'outlier';
  }
  if (!focus.length && biggest && !biggest.flags.includes('low_sample')) {
    focus = [biggest];
    focusReason = 'biggest_leak';
  }
  focus = focus.slice(0, MAX_FOCUS);

  // Experiment sizing for each focus step; the model may pick any of them for the experiment.
  const sizings = focus.map((f) => {
    const p1 = f.conversion;
    const target = f.baseline !== null && f.baseline > p1 ? f.baseline : Math.min(p1 * 1.1, 0.99);
    const n = sampleSizePerVariant(p1, target);
    const dailyTraffic = f.entered / periodDays;
    const days = n && dailyTraffic > 0 ? Math.ceil((2 * n) / dailyTraffic) : null;
    return {
      step: f.name,
      from: round(p1),
      to: round(target),
      basis: f.baseline !== null && f.baseline > p1 ? 'recover last period' : '10% relative lift',
      perVariant: n,
      dailyTraffic: Math.round(dailyTraffic),
      days,
      tooLong: days !== null && days > 42,
    };
  });
  const sizing = sizings[0] || null;

  const dq = dataQuality(input, rows, focus);

  return {
    rows: rows.map((r) => ({
      ...r,
      conversion: round(r.conversion),
      ofTop: round(r.ofTop),
      baseline: round(r.baseline),
      deltaPp: r.deltaPp === null ? null : round(r.deltaPp, 2),
      z: r.z === null ? null : round(r.z, 2),
      lostShare: round(r.lostShare),
      medianOthers: r.medianOthers === undefined ? undefined : round(r.medianOthers),
    })),
    overall: round(rows[rows.length - 1].users / top),
    totalLost,
    focus: focus.map((f) => f.index),
    focusReason,
    sizing,
    sizings,
    dataQuality: dq,
    thresholds: { LOW_SAMPLE, MIN_DROP_PP, Z_SIGNIFICANT, OUTLIER_GAP_PP },
  };
}

// How much the input itself can support a diagnosis. Independent of the model.
function dataQuality(input, rows, focus) {
  let score = 100;
  const notes = [];
  const focusRows = focus.length ? focus : rows.slice(1);

  const minEntered = Math.min(...focusRows.map((r) => r.entered ?? Infinity));
  if (minEntered < LOW_SAMPLE) { score -= 35; notes.push({ delta: -35, text: `Fewer than ${LOW_SAMPLE} users reached a step being diagnosed` }); }
  else if (minEntered < 500) { score -= 15; notes.push({ delta: -15, text: 'Under 500 users at a diagnosed step' }); }

  if (focusRows.some((r) => r.baseline === null)) { score -= 20; notes.push({ delta: -20, text: 'No last-period rate for a diagnosed step' }); }
  if (!input.recentChanges) { score -= 15; notes.push({ delta: -15, text: 'No recent changes provided' }); }

  const avgDesc = input.steps.reduce((a, s) => a + s.description.length, 0) / input.steps.length;
  if (avgDesc < 30) { score -= 10; notes.push({ delta: -10, text: 'Step descriptions are short' }); }
  if (input.steps.length < 3) { score -= 5; notes.push({ delta: -5, text: 'Only two steps' }); }
  if (!focus.length) { score -= 20; notes.push({ delta: -20, text: 'No step stood out from the rest' }); }

  return { score: Math.max(10, score), notes };
}
