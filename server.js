import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateFunnel } from './lib/validate.js';
import { diagnose } from './lib/diagnose.js';
import { llmConfigured, modelName } from './lib/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Each analysis costs a model call; keep one visitor from burning the budget.
const hits = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= 30) return res.status(429).json({ error: 'Too many analyses from this address in the last hour. Try again later.' });
  recent.push(now);
  hits.set(key, recent);
  next();
}

app.post('/api/analyze', rateLimit, async (req, res, next) => {
  try {
    const v = validateFunnel(req.body);
    if (!v.ok) return res.status(400).json({ error: 'Please fix the highlighted fields.', errors: v.errors, warnings: v.warnings });
    const result = await diagnose(v.data);
    res.json({ input: v.data, warnings: v.warnings, ...result });
  } catch (err) {
    next(err);
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, llm: llmConfigured(), model: modelName() }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dropcheck running on http://localhost:${PORT}`);
  if (!llmConfigured()) console.warn('GEMINI_API_KEY is not set: analyses will show the logic-layer report only.');
});
