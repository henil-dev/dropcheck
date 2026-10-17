import { FUNNEL_TYPES } from './validate.js';

export const SYSTEM = `You help a growth manager find out why users drop off at specific funnel steps.

You get funnel facts already calculated by code. Do not recalculate numbers; quote them as given.

Rules:
1. Only diagnose the steps listed under "Diagnose these steps". Use their names exactly.
2. Every reason must point to something concrete in the input: a field, button, requirement, recent change, or number. Put the exact words or number you relied on in "evidence", copied from the input.
3. If a reason is a plausible guess with no direct support in the input, set kind to "assumption" and say what data would confirm it in the evidence field.
4. Never invent facts that are not in the input (prices, releases, competitors, bugs, user quotes).
5. No generic advice. Phrases like "improve UX", "optimize the flow", "streamline", "build trust", "reduce friction", "make it easier" are not acceptable on their own. Name the element and the change.
6. Hypotheses must be testable: "If we <specific change>, then <metric> will <direction> because <reason>."
7. Suggest exactly one experiment, for the step where a fix would recover the most users. It must be something a team could ship in under two weeks.
8. confidence is 0-100: how strongly the input supports your top reason. Lower it when you relied on assumptions.
9. List in missing_info the data that would most change your answer (max 3 items).
Keep every sentence short and plain.`;

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING', description: 'Two sentences max: what most likely happened.' },
    diagnoses: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          step: { type: 'STRING' },
          reasons: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                text: { type: 'STRING' },
                evidence: { type: 'STRING' },
                kind: { type: 'STRING', enum: ['data', 'assumption'] },
              },
              required: ['text', 'evidence', 'kind'],
            },
          },
          hypotheses: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                statement: { type: 'STRING' },
                change: { type: 'STRING' },
                metric: { type: 'STRING' },
              },
              required: ['statement', 'change', 'metric'],
            },
          },
        },
        required: ['step', 'reasons', 'hypotheses'],
      },
    },
    experiment: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        step: { type: 'STRING' },
        control: { type: 'STRING' },
        variant: { type: 'STRING' },
        primary_metric: { type: 'STRING' },
        guardrail_metric: { type: 'STRING' },
        why_first: { type: 'STRING' },
      },
      required: ['title', 'step', 'control', 'variant', 'primary_metric', 'guardrail_metric', 'why_first'],
    },
    confidence: { type: 'INTEGER' },
    confidence_reason: { type: 'STRING' },
    missing_info: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['summary', 'diagnoses', 'experiment', 'confidence', 'confidence_reason', 'missing_info'],
};

const p = (x) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`);

export function buildPrompt(input, logic) {
  const lines = [];
  lines.push(`Funnel: ${input.funnelName}`);
  lines.push(`Type: ${FUNNEL_TYPES[input.funnelType]}`);
  lines.push(`Period: last ${input.periodDays} days`);
  lines.push('');
  lines.push('All steps (calculated by code):');
  for (const r of logic.rows) {
    const parts = [`${r.index + 1}. "${r.name}"`, `users ${r.users}`];
    if (r.index > 0) {
      parts.push(`step conversion ${p(r.conversion)}`);
      if (r.baseline !== null) parts.push(`last period ${p(r.baseline)} (${r.deltaPp > 0 ? '+' : ''}${r.deltaPp.toFixed(1)} pts)`);
      parts.push(`users lost ${r.lost}`);
    }
    if (r.flags.length) parts.push(`flags: ${r.flags.join(', ')}`);
    lines.push(`- ${parts.join(' | ')}`);
    lines.push(`  What the user sees: ${r.description}`);
    if (r.signals.length) lines.push(`  Friction signals found by rules: ${r.signals.map((s) => s.label).join('; ')}`);
  }
  lines.push('');
  lines.push(`Recent changes (from the user): ${input.recentChanges || 'none given'}`);
  lines.push('');
  lines.push('Diagnose these steps:');
  for (const i of logic.focus) {
    const r = logic.rows[i];
    let why = '';
    if (r.flags.includes('regression')) why = `conversion fell from ${p(r.baseline)} to ${p(r.conversion)}, statistically significant (z=${r.z})`;
    else if (r.flags.includes('outlier')) why = `converts at ${p(r.conversion)} vs ${p(r.medianOthers)} median for other steps`;
    else why = `loses the most users (${r.lost}), no abnormal change detected`;
    lines.push(`- "${r.name}": ${why}`);
    if (r.relatedChanges.length) lines.push(`  Recent change that mentions this step: ${r.relatedChanges.join(' ')}`);
  }
  lines.push('');
  lines.push('For each step give 2-3 reasons and 2-3 hypotheses. Then one experiment.');
  return lines.join('\n');
}

export function retryNote(problems) {
  return `Some lines in your answer were rejected:\n${problems.map((x) => `- "${x.text}": ${x.why}`).join('\n')}\n\nRewrite the full answer in the same JSON format. Each reason and hypothesis must name a specific element from the step description, a recent change, or a number from the input. Keep the rest of the rules.`;
}
