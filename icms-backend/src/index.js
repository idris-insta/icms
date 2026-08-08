require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173'];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/orders',    require('./routes/orders'));
app.use('/api/financial', require('./routes/financial'));
app.use('/api/masters',   require('./routes/masters'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/reports',   require('./routes/reports'));
app.use('/api/settings',  require('./routes/settings'));
app.use('/api/costing',   require('./routes/costing'));
app.use('/api/agent',     require('./routes/agent'));
app.use('/api/alerts',    require('./routes/alerts'));
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/analytics', require('./routes/analytics'));

// ── Health check (also tests DB) ──────────────────────────────────────────────
const protect = require('./middleware/auth');
app.get('/api/health', protect, async (req, res) => {
  const db = require('./db');
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', ts: new Date() });
  } catch (err) {
    console.error('[health]', err);
    res.status(503).json({ status: 'degraded', db: 'disconnected', ts: new Date() });
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS: origin not allowed' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Production safety checks ──────────────────────────────────────────────────
const WEAK_SECRETS = ['', 'icms_jwt_secret_key_2024', 'secret', 'changeme'];
if (process.env.NODE_ENV === 'production' && WEAK_SECRETS.includes(process.env.JWT_SECRET || '')) {
  console.error('FATAL: JWT_SECRET is missing or using a default value. Set a strong JWT_SECRET before deploying.');
  process.exit(1);
}
if (WEAK_SECRETS.includes(process.env.JWT_SECRET || '')) {
  console.warn('⚠️  JWT_SECRET is weak/default — change it before production.');
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ICMS API running on http://localhost:${PORT}`));
