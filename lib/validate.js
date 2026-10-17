export const FUNNEL_TYPES = {
  saas_signup: 'SaaS signup / trial',
  ecommerce_checkout: 'E-commerce checkout',
  mobile_onboarding: 'Mobile app onboarding',
  lead_gen: 'Lead generation',
  other: 'Other',
};

const MIN_STEPS = 2;
const MAX_STEPS = 10;

function clean(s) {
  return typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : '';
}

function toNumber(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

// Returns { ok, errors, warnings, data }. errors block the request, warnings don't.
export function validateFunnel(body) {
  const errors = [];
  const warnings = [];
  const b = body && typeof body === 'object' ? body : {};

  const funnelName = clean(b.funnelName);
  if (!funnelName) errors.push({ field: 'funnelName', message: 'Give the funnel a name.' });
  else if (funnelName.length > 80) errors.push({ field: 'funnelName', message: 'Funnel name is too long (80 characters max).' });

  const funnelType = FUNNEL_TYPES[b.funnelType] ? b.funnelType : null;
  if (!funnelType) errors.push({ field: 'funnelType', message: 'Pick a funnel type.' });

  const periodDays = toNumber(b.periodDays);
  if (periodDays === null || Number.isNaN(periodDays) || !Number.isInteger(periodDays) || periodDays < 1 || periodDays > 90) {
    errors.push({ field: 'periodDays', message: 'Period must be a whole number of days between 1 and 90.' });
  }

  const recentChanges = clean(b.recentChanges);
  if (recentChanges.length > 1500) errors.push({ field: 'recentChanges', message: 'Recent changes is too long (1500 characters max).' });
  if (!recentChanges) warnings.push('No recent changes given. The diagnosis will rely only on step descriptions, so confidence will be lower.');

  const rawSteps = Array.isArray(b.steps) ? b.steps : [];
  if (rawSteps.length < MIN_STEPS) errors.push({ field: 'steps', message: `Add at least ${MIN_STEPS} steps.` });
  if (rawSteps.length > MAX_STEPS) errors.push({ field: 'steps', message: `Use ${MAX_STEPS} steps or fewer.` });

  const steps = rawSteps.slice(0, MAX_STEPS).map((s, i) => {
    const step = {
      name: clean(s?.name),
      description: clean(s?.description),
      users: toNumber(s?.users),
      baselineRate: i === 0 ? null : toNumber(s?.baselineRate),
    };
    const label = `Step ${i + 1}`;
    const f = (k) => `steps.${i}.${k}`;

    if (!step.name) errors.push({ field: f('name'), message: `${label}: name is missing.` });
    else if (step.name.length > 60) errors.push({ field: f('name'), message: `${label}: name is too long (60 max).` });

    if (step.description.length < 10) {
      errors.push({ field: f('description'), message: `${label}: describe what the user sees or does here (at least 10 characters).` });
    } else if (step.description.length > 400) {
      errors.push({ field: f('description'), message: `${label}: description is too long (400 max).` });
    } else if (step.description.length < 25) {
      warnings.push(`${label}: the description is short. More detail (fields, buttons, requirements) gives more specific hypotheses.`);
    }

    if (step.users === null || Number.isNaN(step.users) || !Number.isInteger(step.users) || step.users < 0) {
      errors.push({ field: f('users'), message: `${label}: users must be a whole number, 0 or more.` });
    }

    if (step.baselineRate !== null && (Number.isNaN(step.baselineRate) || step.baselineRate < 0 || step.baselineRate > 100)) {
      errors.push({ field: f('baselineRate'), message: `${label}: last period's conversion must be between 0 and 100.` });
    }
    return step;
  });

  if (steps[0] && Number.isInteger(steps[0].users) && steps[0].users < 1) {
    errors.push({ field: 'steps.0.users', message: 'Step 1 needs at least 1 user.' });
  }

  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1].users;
    const cur = steps[i].users;
    if (Number.isInteger(prev) && Number.isInteger(cur) && cur > prev) {
      errors.push({
        field: `steps.${i}.users`,
        message: `Step ${i + 1} has more users (${cur}) than step ${i} (${prev}). A funnel can only lose users. Check the numbers or the step order.`,
      });
    }
  }

  const names = steps.map((s) => s.name.toLowerCase()).filter(Boolean);
  if (new Set(names).size !== names.length) errors.push({ field: 'steps', message: 'Two steps have the same name. Give each step a unique name.' });

  if (steps.length > 1 && steps.slice(1).every((s) => s.baselineRate === null)) {
    warnings.push("No last-period conversion rates given. Drops will be compared with the funnel's other steps instead of history.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    data: { funnelName, funnelType, periodDays, recentChanges, steps },
  };
}
