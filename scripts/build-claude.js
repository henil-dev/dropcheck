// Builds claude/index.html, the page published on claude.ai, from the Node app's form markup
// so both versions keep the same form. Run: npm run build:claude
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('public/index.html', 'utf8');
const main = src.match(/<main class="wrap">([\s\S]*?)<\/main>/)[1];

const page = `<title>Dropcheck</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">

<header class="top">
  <div class="wrap">
    <a class="brand" href="#new">drop<span>check</span></a>
    <nav class="nav">
      <a href="#new" data-view="new">New analysis</a>
      <a href="#history" data-view="history">History</a>
      <a href="#admin" data-view="admin" id="nav-admin" hidden>Admin</a>
    </nav>
  </div>
</header>

<main class="wrap">
  <div id="view-new">
${main}
  </div>

  <div id="view-history" hidden>
    <h1>Past analyses</h1>
    <p class="lede">Every analysis is saved, including the ones where the AI step failed.</p>
    <section class="block" id="history-list"></section>
  </div>

  <div id="view-report" hidden>
    <p class="small" style="margin:0 0 8px"><a href="#history">&larr; All analyses</a></p>
    <h1 id="report-title">Analysis</h1>
    <p class="lede" id="report-meta"></p>
    <div id="report-body"></div>
  </div>

  <div id="view-admin" hidden>
    <h1>Admin</h1>
    <p class="lede" id="admin-sub">Usage, quality checks and cost.</p>
    <div id="admin-body"></div>
  </div>
</main>

<footer class="wrap">Dropcheck runs its checks in your browser and uses your own Claude account for the diagnosis. Source: <a href="https://github.com/henil-dev/dropcheck">github.com/henil-dev/dropcheck</a></footer>

<script type="module" src="main.js"></script>
`;

writeFileSync('claude/index.html', page);
console.log('wrote claude/index.html');
