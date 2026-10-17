import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateFunnel } from './lib/validate.js';
import { analyzeFunnel } from './lib/funnel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.post('/api/analyze', (req, res) => {
  const v = validateFunnel(req.body);
  if (!v.ok) return res.status(400).json({ error: 'Please fix the highlighted fields.', errors: v.errors, warnings: v.warnings });
  const logic = analyzeFunnel(v.data);
  res.json({ input: v.data, warnings: v.warnings, logic });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Dropcheck running on http://localhost:${PORT}`));
