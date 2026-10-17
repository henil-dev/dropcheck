// Checks on the model's answer. We don't let the model grade itself.
import { words } from './funnel.js';

export class ShapeError extends Error {}

const VAGUE = [
  /\b(improve|enhance|optimi[sz]e|streamline|simplify|refine)\b.{0,30}\b(ux|user experience|experience|flow|journey|process|design|usability|funnel)\b/i,
  /\buser[- ]friendly\b/i,
  /\bbuild(ing)? trust\b/i,
  /\breduce (the )?friction\b/i,
  /\bmake (it|things|the process) (easier|simpler|clearer|smoother|more intuitive)\b/i,
  /\bbetter (ux|design|messaging|copy|onboarding|experience)\b/i,
  /\bbest practices?\b/i,
  /\bengag(e|ing) (users|customers)\b/i,
];

const str = (x) => (typeof x === 'string' ? x.trim() : '');

// Make sure the JSON has what the UI needs, trim it to the limits we promise.
export function shape(rawText, focusNames) {
  let d;
  try {
    d = JSON.parse(rawText);
  } catch {
    throw new ShapeError('Model output was not valid JSON.');
  }
  if (!d || typeof d !== 'object') throw new ShapeError('Model output was empty.');

  const wanted = new Map(focusNames.map((n) => [n.toLowerCase(), n]));
  const diagnoses = (Array.isArray(d.diagnoses) ? d.diagnoses : [])
    .map((x) => ({
      step: wanted.get(str(x?.step).toLowerCase()),
      reasons: (Array.isArray(x?.reasons) ? x.reasons : [])
        .map((r) => ({ text: str(r?.text), evidence: str(r?.evidence), kind: r?.kind === 'assumption' ? 'assumption' : 'data' }))
        .filter((r) => r.text)
        .slice(0, 3),
      hypotheses: (Array.isArray(x?.hypotheses) ? x.hypotheses : [])
        .map((h) => ({ statement: str(h?.statement), change: str(h?.change), metric: str(h?.metric) }))
        .filter((h) => h.statement)
        .slice(0, 3),
    }))
    .filter((x) => x.step && x.reasons.length && x.hypotheses.length);

  if (!diagnoses.length) throw new ShapeError('Model output did not diagnose any of the requested steps.');

  const e = d.experiment || {};
  const experiment = {
    title: str(e.title),
    step: wanted.get(str(e.step).toLowerCase()) || str(e.step),
    control: str(e.control),
    variant: str(e.variant),
    primary_metric: str(e.primary_metric),
    guardrail_metric: str(e.guardrail_metric),
    why_first: str(e.why_first),
  };
  if (!experiment.title || !experiment.variant) throw new ShapeError('Model output had no usable experiment.');

  const conf = Number(d.confidence);
  return {
    summary: str(d.summary),
    diagnoses,
    experiment,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(100, Math.round(conf))) : 50,
    confidence_reason: str(d.confidence_reason),
    missing_info: (Array.isArray(d.missing_info) ? d.missing_info : []).map(str).filter(Boolean).slice(0, 3),
  };
}

function numbersIn(text) {
  return (String(text).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', ''));
}

function corpus(input, logic) {
  const textParts = [input.funnelName, input.recentChanges, ...input.steps.flatMap((s) => [s.name, s.description])];
  const w = new Set(words(textParts.join(' ')));
  for (const r of logic.rows) r.signals.forEach((s) => words(s.label).forEach((x) => w.add(x)));

  const nums = new Set(numbersIn(textParts.join(' ')));
  for (const r of logic.rows) {
    nums.add(String(r.users));
    if (r.lost) nums.add(String(r.lost));
    for (const v of [r.conversion, r.baseline]) {
      if (v === null) continue;
      nums.add((v * 100).toFixed(1));
      nums.add(String(Math.round(v * 100)));
    }
    if (r.deltaPp !== null) {
      nums.add(Math.abs(r.deltaPp).toFixed(1));
      nums.add(String(Math.round(Math.abs(r.deltaPp))));
    }
    if (r.z !== null) nums.add(String(r.z));
  }
  return { w, nums };
}

// Words that only count as "specific" if they come from the step's own details.
// Recent changes count for every step: a campaign change can hit any step.
function stepContext(logic, stepName, recentChanges) {
  const r = logic.rows.find((x) => x.name === stepName);
  if (!r) return new Set();
  const nameWords = new Set(words(r.name));
  const ctx = words(`${r.description} ${recentChanges}`).filter((w) => !nameWords.has(w));
  return new Set(ctx);
}

function isGeneric(text, ctx) {
  const overlap = words(text).filter((w) => ctx.has(w)).length;
  const hasNumber = /\d/.test(text);
  const vague = VAGUE.some((re) => re.test(text));
  if (vague) return overlap < 2;
  return overlap === 0 && !hasNumber;
}

function isSupported(evidence, c) {
  const ew = words(evidence);
  const en = numbersIn(evidence);
  if (!ew.length && !en.length) return false;
  const wordHits = ew.filter((w) => c.w.has(w)).length;
  const numHits = en.filter((n) => c.nums.has(n) || c.nums.has(String(Math.round(Number(n))))).length;
  const total = ew.length + en.length;
  return (wordHits + numHits) / total >= 0.6;
}

// Annotates each reason/hypothesis with check results and returns problem lines for a retry.
export function review(ai, input, logic) {
  const c = corpus(input, logic);
  const problems = [];
  let generic = 0;
  let unsupported = 0;
  let assumptions = 0;

  for (const d of ai.diagnoses) {
    const ctx = stepContext(logic, d.step, input.recentChanges);
    for (const r of d.reasons) {
      r.checks = {};
      if (isGeneric(r.text, ctx)) {
        r.checks.generic = true;
        generic++;
        problems.push({ text: r.text, why: 'too generic, names nothing specific from this step' });
      }
      if (r.kind === 'assumption') {
        assumptions++;
      } else if (!isSupported(r.evidence, c)) {
        r.checks.unsupported = true;
        unsupported++;
        problems.push({ text: r.text, why: `evidence "${r.evidence}" does not appear in the input` });
      }
    }
    for (const h of d.hypotheses) {
      h.checks = {};
      if (isGeneric(`${h.statement} ${h.change}`, ctx)) {
        h.checks.generic = true;
        generic++;
        problems.push({ text: h.statement, why: 'too generic to test' });
      }
    }
  }
  return { generic, unsupported, assumptions, problems };
}

// Final score = the weaker of what the data supports and what the model claims, minus check penalties.
export function scoreConfidence(dataQuality, ai, checks) {
  const parts = [{ label: 'Data quality (from the logic layer)', value: dataQuality.score }];
  if (!ai) {
    return { score: dataQuality.score, label: label(dataQuality.score), parts, notes: dataQuality.notes };
  }
  parts.push({ label: "Model's own confidence", value: ai.confidence });
  let score = Math.min(dataQuality.score, ai.confidence);
  const penalties = [];
  if (checks.generic) penalties.push({ label: `${checks.generic} generic line(s)`, value: -8 * checks.generic });
  if (checks.unsupported) penalties.push({ label: `${checks.unsupported} reason(s) without matching evidence`, value: -8 * checks.unsupported });
  if (checks.assumptions) penalties.push({ label: `${checks.assumptions} reason(s) marked as assumption`, value: -3 * checks.assumptions });
  for (const p of penalties) score += p.value;
  score = Math.max(5, Math.min(95, Math.round(score)));
  return { score, label: label(score), parts, penalties, notes: dataQuality.notes };
}

function label(s) {
  return s >= 70 ? 'High' : s >= 40 ? 'Medium' : 'Low';
}
