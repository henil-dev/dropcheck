# Dropcheck

Find out why users drop off at a funnel step, and what to test first.

Built for Airtribe's "From Workflow Pain to a Working AI Product" project, Track 3 (Marketing & Growth: Funnel Drop-off Diagnosis).

**JTBD:** When I see a drop in conversion, I want to understand the cause and what to test, so I can improve the funnel.

Product brief: [`docs/product-brief.pdf`](docs/product-brief.pdf) (source: [`docs/product-brief.md`](docs/product-brief.md))

## How it works

```
Form ─► Validation ─► Logic layer ─► Prompt ─► Gemini ─► Parse ─► Checks + confidence ─► SQLite ─► Report / Admin
```

| Stage | File | What it does |
|---|---|---|
| Structured input | `public/index.html`, `public/app.js` | Steps with name, description, users, optional last-period rate, plus "what changed recently" |
| Validation | `lib/validate.js` | Blocks impossible funnels (a step with more users than the one before), missing descriptions, bad numbers |
| Logic layer | `lib/funnel.js` | Conversion math, z-test against last period, outlier detection without a baseline, low-sample guard, friction keywords, linking recent changes to steps, A/B test sample size and duration |
| Prompt | `lib/prompt.js` | Sends only the flagged steps plus calculated facts. The model never does the math |
| LLM call | `lib/llm.js` | Gemini REST API, JSON schema output, timeout, one retry on 429/5xx, fallback model on 404 |
| Output checks | `lib/review.js` | Flags generic advice and reasons whose evidence isn't in the input, retries once with the problems quoted back |
| Confidence | `lib/review.js` | `min(data quality, model confidence)` minus penalties for flagged lines |
| Storage | `lib/db.js` | SQLite: every analysis (including failures), rejected inputs, feedback |
| Dashboard | `public/admin.html`, `lib/stats.js` | Usage, AI failures, retries, flagged lines, confidence mix, tokens and cost, delete runs |

If the AI call fails or no key is set, the user still gets the full logic-layer report.

## Run it

```bash
npm install
GEMINI_API_KEY=your-key npm start
```

Open http://localhost:3000 and click **Fill with an example**.

### Environment variables

| Name | Required | Default |
|---|---|---|
| `GEMINI_API_KEY` | yes, for the AI step | — |
| `GEMINI_MODEL` | no | `gemini-2.5-flash` |
| `ADMIN_PASSWORD` | no (admin is open without it) | — |
| `DB_PATH` | no | `data/dropcheck.db` |
| `PORT` | no | `3000` |

On Replit, add these under **Secrets**.

## Pages

- `/` new analysis
- `/history` past analyses
- `/report?id=N` a saved analysis
- `/admin` dashboard
