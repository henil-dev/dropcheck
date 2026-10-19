// Single-page shell for the Claude-hosted version: switches views on the URL hash.
import './app.js';
import { renderHistory, renderSavedReport, renderAdmin } from './views.js';
import { canSeeAdmin } from './api.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['new', 'history', 'report', 'admin'];
let isEditor = false;

function show(name) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === (name === 'report' ? 'history' : name)));
  window.scrollTo(0, 0);
}

function route() {
  const hash = location.hash.slice(1) || 'new';
  if (hash.startsWith('report-')) {
    show('report');
    renderSavedReport($('report-body'), hash.slice(7), { titleEl: $('report-title'), metaEl: $('report-meta') });
  } else if (hash === 'history') {
    show('history');
    renderHistory($('history-list'));
  } else if (hash === 'admin') {
    show('admin');
    if (isEditor) renderAdmin($('admin-body'), $('admin-sub'));
    else $('admin-body').innerHTML = '<div class="alert info">The admin dashboard is only shown to the people who can edit this page.</div>';
  } else {
    show('new');
  }
}

window.addEventListener('hashchange', route);
route();

// The admin link appears once the viewer is known to be an editor (resolves after first paint).
canSeeAdmin().then((yes) => {
  isEditor = yes;
  $('nav-admin').hidden = !yes;
  if (location.hash === '#admin') route();
});
