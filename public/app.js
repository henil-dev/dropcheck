import { esc } from '/util.js';

const form = document.getElementById('funnel-form');
const body = document.getElementById('steps-body');
const alertBox = document.getElementById('form-alert');
const resultBox = document.getElementById('result');
const submitBtn = document.getElementById('submit');
const progress = document.getElementById('progress');

const EXAMPLE = {
  funnelName: 'Self-serve trial (web)',
  funnelType: 'saas_signup',
  periodDays: 7,
  recentChanges:
    'Oct 6: made phone number a required field on the signup form (sales asked for it). Oct 8: "Invite teammates" screen in onboarding changed from optional to required, the Skip link was removed. Paid search budget up 40% this week, mostly broad-match keywords.',
  steps: [
    { name: 'Pricing page', description: 'Three plans shown, "Start free trial" button above the fold, no card needed message under the button', users: 24000 },
    { name: 'Signup form', description: 'Fields: work email, password, company name, phone number. Google sign-in button at the top', users: 6240, baselineRate: 31 },
    { name: 'Email verification', description: 'User must click the link in a confirmation email before they can open the app', users: 4180, baselineRate: 70 },
    { name: 'Onboarding wizard', description: '3 screens: pick a use case, invite at least 2 teammates, connect Slack (Slack is optional)', users: 2090, baselineRate: 62 },
    { name: 'Add card', description: 'Modal on day 3 of the trial asking for card details to keep the trial running', users: 610, baselineRate: 31 },
  ],
};

function stepRow(step = {}, index = 0) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${index + 1}</td>
    <td class="c-name"><input data-k="name" maxlength="60" placeholder="e.g. Signup form" value="${esc(step.name ?? '')}"></td>
    <td><textarea data-k="description" maxlength="400" placeholder="Fields, buttons, requirements, anything the user must do">${esc(step.description ?? '')}</textarea></td>
    <td class="c-users"><input data-k="users" inputmode="numeric" placeholder="0" value="${step.users ?? ''}"></td>
    <td class="c-base"><input data-k="baselineRate" inputmode="decimal" placeholder="${index === 0 ? '—' : 'optional'}" value="${step.baselineRate ?? ''}" ${index === 0 ? 'disabled' : ''}></td>
    <td class="c-x"><button type="button" class="x" title="Remove step" aria-label="Remove step">×</button></td>`;
  tr.querySelector('.x').addEventListener('click', () => {
    if (body.children.length <= 2) return;
    tr.remove();
    renumber();
  });
  return tr;
}

function renumber() {
  [...body.children].forEach((tr, i) => {
    tr.firstElementChild.textContent = i + 1;
    const base = tr.querySelector('[data-k="baselineRate"]');
    base.disabled = i === 0;
    base.placeholder = i === 0 ? '—' : 'optional';
    if (i === 0) base.value = '';
  });
}

function setSteps(steps) {
  body.innerHTML = '';
  steps.forEach((s, i) => body.appendChild(stepRow(s, i)));
}

function readForm() {
  return {
    funnelName: form.funnelName.value,
    funnelType: form.funnelType.value,
    periodDays: form.periodDays.value,
    recentChanges: form.recentChanges.value,
    steps: [...body.children].map((tr) => {
      const get = (k) => tr.querySelector(`[data-k="${k}"]`).value;
      return { name: get('name'), description: get('description'), users: get('users'), baselineRate: get('baselineRate') };
    }),
  };
}

function fill(data) {
  form.funnelName.value = data.funnelName;
  form.funnelType.value = data.funnelType;
  form.periodDays.value = data.periodDays;
  form.recentChanges.value = data.recentChanges;
  setSteps(data.steps);
}

function markInvalid(errors = []) {
  form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  for (const e of errors) {
    const m = /^steps\.(\d+)\.(\w+)$/.exec(e.field || '');
    let el = null;
    if (m) el = body.children[Number(m[1])]?.querySelector(`[data-k="${m[2]}"]`);
    else if (form[e.field]) el = form[e.field];
    el?.classList.add('invalid');
  }
}

function showAlert(kind, title, items = []) {
  alertBox.innerHTML = `<div class="alert ${kind}"><strong>${esc(title)}</strong>${
    items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''
  }</div>`;
}

const STAGES = ['Validating input', 'Running checks', 'Asking the model', 'Checking the answer'];
let timer = null;
function startProgress() {
  let i = 0;
  progress.hidden = false;
  const draw = () => {
    progress.innerHTML = STAGES.map((s, n) => `<span class="${n < i ? 'done' : n === i ? 'now' : ''}">${s}</span>`).join('');
  };
  draw();
  timer = setInterval(() => { if (i < STAGES.length - 1) { i++; draw(); } }, 1400);
}
function stopProgress() {
  clearInterval(timer);
  progress.hidden = true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.innerHTML = '';
  resultBox.innerHTML = '';
  markInvalid();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Checking…';
  startProgress();

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readForm()),
    });
    const json = await res.json().catch(() => ({ error: 'The server sent back something unexpected.' }));
    if (!res.ok) {
      markInvalid(json.errors);
      showAlert('err', json.error || 'Request failed.', (json.errors || []).map((x) => x.message));
      return;
    }
    if (json.warnings?.length) showAlert('warn', 'Ran with a few caveats', json.warnings);
    resultBox.innerHTML = `<div class="alert info">Input is valid: ${json.input.steps.length} steps.</div>`;
  } catch {
    showAlert('err', 'Could not reach the server. Check your connection and try again.');
  } finally {
    stopProgress();
    submitBtn.disabled = false;
    submitBtn.textContent = 'Diagnose';
  }
});

document.getElementById('add-step').addEventListener('click', () => {
  if (body.children.length >= 10) return showAlert('warn', 'Ten steps is the maximum.');
  body.appendChild(stepRow({}, body.children.length));
});
document.getElementById('load-example').addEventListener('click', () => fill(EXAMPLE));

setSteps([{}, {}, {}]);
