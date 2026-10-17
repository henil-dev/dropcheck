import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateFunnel } from './lib/validate.js';
import { diagnose } from './lib/diagnose.js';
import { llmConfigured, modelName } from './lib/llm.js';
import { saveAnalysis, logRejection, listAnalyses, getAnalysis, setFeedback, deleteAnalysis } from './lib/db.js';
import { adminStats } from './lib/stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Replit sits behind a proxy; needed for per-IP rate limiting
app.use(express.json({ limit: '100kb' }));

// Admin is protected with HTTP Basic auth when ADMIN_PASSWORD is set (user name can be anything).
function adminAuth(req, res, next) {
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) return next();
  const [, encoded] = (req.headers.authorization || '').split(' ');
  const given = encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : '';
  if (given === pass) return next();
  res.set('WWW-Authenticate', 'Basic realm="Dropcheck admin"').status(401).send('Admin password required.');
}
app.use(['/admin', '/admin.html', '/api/admin'], adminAuth);

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
    if (!v.ok) {
      logRejection(v.errors);
      return res.status(400).json({ error: 'Please fix the highlighted fields.', errors: v.errors, warnings: v.warnings });
    }
    const result = await diagnose(v.data);
    const id = saveAnalysis(v.data, v.warnings, result);
    res.json({ id, input: v.data, warnings: v.warnings, ...result });
  } catch (err) {
    next(err);
  }
});

app.get('/api/analyses', (req, res) => res.json(listAnalyses()));

app.get('/api/analyses/:id', (req, res) => {
  const a = getAnalysis(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Analysis not found.' });
  res.json(a);
});

app.post('/api/analyses/:id/feedback', (req, res) => {
  const { feedback, note } = req.body || {};
  if (!['useful', 'not_useful'].includes(feedback)) return res.status(400).json({ error: 'feedback must be "useful" or "not_useful".' });
  if (note && String(note).length > 500) return res.status(400).json({ error: 'Note is too long (500 max).' });
  if (!setFeedback(Number(req.params.id), feedback, note && String(note).trim())) return res.status(404).json({ error: 'Analysis not found.' });
  res.json({ ok: true });
});

app.get('/api/admin/stats', (req, res) => {
  res.json({ ...adminStats(), llm: { configured: llmConfigured(), model: modelName() }, protected: Boolean(process.env.ADMIN_PASSWORD) });
});

app.delete('/api/admin/analyses/:id', (req, res) => {
  if (!deleteAnalysis(Number(req.params.id))) return res.status(404).json({ error: 'Analysis not found.' });
  res.json({ ok: true });
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
