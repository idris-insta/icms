require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

// Behind nginx / a load balancer, req.ip must come from X-Forwarded-For or the
// login rate limiter would bucket every user under the proxy's address.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173'];

/**
 * A request is same-origin when its Origin header matches the Host it was sent
 * to. In production the SPA is served by this very process, so its own origin
 * is never in CORS_ORIGINS — without this check the app would reject its own
 * asset requests with 403 and render a blank page.
 */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;                 // curl, server-to-server, <script> loads
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

app.use(cors((req, cb) => {
  const origin = req.headers.origin;
  const list = allowedOrigins.length ? allowedOrigins : DEV_ORIGINS;
  const ok = isSameOrigin(req) || (origin && list.includes(origin));
  if (ok) return cb(null, { origin: true, credentials: true });
  cb(new Error('Not allowed by CORS'));
}));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/users',     require('./routes/users'));
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

// ── Health check ──────────────────────────────────────────────────────────────
// Unauthenticated on purpose: Docker/compose and any load balancer need to
// probe it before a token exists. It reveals only up/down, never data.
app.get('/api/health', async (req, res) => {
  const db = require('./db');
  try {
    await db.ping();
    res.json({ status: 'ok', db: 'connected', client: db.CLIENT, ts: new Date() });
  } catch (err) {
    console.error('[health]', err.message);
    res.status(503).json({ status: 'degraded', db: 'disconnected', ts: new Date() });
  }
});

// ── Static frontend ───────────────────────────────────────────────────────────
// In the container the built SPA is copied next to the API and served from the
// same origin, which also means no CORS configuration is needed in production.
const fs = require('fs');
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..', 'public');
const hasStatic = fs.existsSync(path.join(STATIC_DIR, 'index.html'));
if (hasStatic) {
  app.use(express.static(STATIC_DIR));
  console.log(`Serving frontend from ${STATIC_DIR}`);
}

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  // Unknown /api paths are genuine 404s; anything else is a client-side route.
  if (!req.path.startsWith('/api/') && hasStatic) {
    return res.sendFile(path.join(STATIC_DIR, 'index.html'));
  }
  res.status(404).json({ error: 'Not found' });
});

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
