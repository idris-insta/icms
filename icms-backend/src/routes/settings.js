const router    = require('express').Router();
const db        = require('../db');
const protect   = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// GET /api/settings
router.get('/', protect, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT key, value FROM settings ORDER BY key');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json({ settings });
  } catch (err) {
    console.error('[settings/get]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/settings — body: { key: value, ... }
router.put('/', protect, authorize('owner'), async (req, res) => {
  const entries = Object.entries(req.body);
  if (!entries.length) return res.status(400).json({ error: 'No settings provided' });
  try {
    await Promise.all(entries.map(([key, value]) =>
      db.query(`
        INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
      `, [key, value])
    ));
    const { rows } = await db.query('SELECT key, value FROM settings ORDER BY key');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json({ settings });
  } catch (err) {
    console.error('[settings/put]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
