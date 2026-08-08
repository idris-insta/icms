const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const protect = require('../middleware/auth');

// In-memory login rate limiter: max 10 attempts per IP per 15 minutes
const loginAttempts = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 10;

function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (rec && now < rec.resetAt) {
    if (rec.count >= RATE_MAX) {
      return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    }
    rec.count++;
  } else {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
  }
  // Prune old entries occasionally to avoid unbounded memory growth
  if (loginAttempts.size > 5000) {
    for (const [k, v] of loginAttempts) {
      if (now >= v.resetAt) loginAttempts.delete(k);
    }
  }
  next();
}

// POST /api/auth/login
router.post('/login', rateLimitLogin, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const { rows } = await db.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: payload });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me — re-validates against DB so deactivated users are rejected
router.get('/me', protect, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, email, name, role FROM users WHERE id = $1 AND is_active = true',
      [req.user.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Account inactive or not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
