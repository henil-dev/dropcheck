# Dropcheck

Find out why users drop off at a funnel step, and what to test first.

Built for Airtribe's "From Workflow Pain to a Working AI Product" project, Track 3 (Marketing & Growth: Funnel Drop-off Diagnosis).

**JTBD:** When I see a drop in conversion, I want to understand the cause and what to test, so I can improve the funnel.

- **Live app:** https://claude.ai/artifact/8qcZS74zJutWY7zXg7YrEW (open while signed in to claude.ai)
- **Product brief:** [`docs/product-brief.pdf`](docs/product-brief.pdf) (source: [`docs/product-brief.md`](docs/product-brief.md))

**Tools:** built in Claude Code, versioned on GitHub, published as a Claude page, Claude as the LLM.

## How it works

```
Form ─► Validation ─► Logic layer ─► Prompt ─► Claude ─► Parse ─► Checks + confidence ─► Database ─► Report / Admin
```

| Stage | File | What it does |
|---|---|---|
| Structured input | `public/index.html`, `public/app.js` | Steps with name, description, users, optional last-period rate, plus "what changed recently" |
| Validation | `lib/validate.js` | Blocks impossible funnels (a step with more users than the one before), missing descriptions, bad numbers |
| Logic layer | `lib/funnel.js` | Conversion math, z-test against last period, outlier detection without a baseline, low-sample guard, friction keywords, linking recent changes to steps, A/B test sample size and duration |
| Prompt | `lib/prompt.js` | Sends only the flagged steps plus calculated facts. The model never does the math |
| LLM call | `claude/api.js` | Claude, through the page's `sample` capability (runs on the viewer's own Claude plan) |
| Output checks | `lib/review.js` | Flags generic advice and reasons whose evidence isn't in the input, retries once with the problems quoted back |
| Confidence | `lib/review.js` | `min(data quality, model confidence)` minus penalties for flagged lines |
| Storage | `claude/api.js` | The page's built-in database: every analysis (including failures), rejected inputs, feedback |
| Dashboard | `public/views.js` | Usage, AI failures, retries, flagged lines, confidence mix, delete runs. Shown only to editors of the page |

`lib/diagnose.js` runs the pipeline and takes the model as a plug-in, so the same checks run with Claude on the published page or with Gemini in the local Node version below.

If Claude is unavailable (signed out, declined, limit reached), the viewer still gets the full logic-layer report.

## Publish the Claude page

The page is built from the same files as the Node app:

```bash
npm run build:claude
```

This writes `claude/index.html`. Publish it from Claude Code as an artifact with these files next to it: `public/styles.css`, `public/util.js`, `public/render.js`, `public/app.js`, `public/views.js`, `claude/api.js` (as `api.js`), `claude/main.js` (as `main.js`) and `lib/{validate,funnel,review,prompt,diagnose}.js` (under `lib/`). Capabilities: `sample`, `db`, `user`.

To let others use it, open the page on claude.ai, click **Share**, and turn on link sharing.

## Run it locally (Node + Gemini)

```bash
npm install
GEMINI_API_KEY=your-key npm start
```

Open http://localhost:3000 and click **Fill with an example**. Without a key you get the logic-layer report only.

| Name | Required | Default |
|---|---|---|
| `GEMINI_API_KEY` | yes, for the AI step | — |
| `GEMINI_MODEL` | no | `gemini-2.5-flash` |
| `ADMIN_PASSWORD` | no (admin is open without it) | — |
| `DB_PATH` | no | `data/dropcheck.db` (SQLite) |
| `PORT` | no | `3000` |

Pages: `/` new analysis, `/history`, `/report?id=N`, `/admin`.
