const router    = require('express').Router();
const bcrypt    = require('bcryptjs');
const db        = require('../db');
const protect   = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// User management — owner only. Roles: owner, manager, staff, viewer.
const ROLES = ['owner', 'manager', 'staff', 'viewer'];
const ownerOnly = authorize('owner');

// GET /api/users — list all users (no password hashes)
router.get('/', protect, ownerOnly, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, email, name, role, is_active, created_at FROM users ORDER BY created_at'
    );
    res.json({ users: rows });
  } catch (err) {
    console.error('[users/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users — create user
router.post('/', protect, ownerOnly, async (req, res) => {
  const { email, name, password, role } = req.body;
  if (!email || !name || !password) return res.status(400).json({ error: 'Email, name and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(`
      INSERT INTO users (email, name, password_hash, role, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING id, email, name, role, is_active, created_at
    `, [email.toLowerCase().trim(), name.trim(), hash, role || 'staff']);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A user with that email already exists' });
    console.error('[users/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id — edit name / email / role / active
router.put('/:id', protect, ownerOnly, async (req, res) => {
  const { email, name, role, is_active } = req.body;
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const id = parseInt(req.params.id);
  try {
    // Guard: never let the last active owner be demoted or deactivated (lockout safety)
    if (role && role !== 'owner' || is_active === false) {
      const cur = (await db.query('SELECT role, is_active FROM users WHERE id=$1', [id])).rows[0];
      if (cur && cur.role === 'owner' && cur.is_active) {
        const owners = (await db.query("SELECT COUNT(*)::int AS n FROM users WHERE role='owner' AND is_active=true")).rows[0].n;
        if (owners <= 1) return res.status(400).json({ error: 'Cannot demote or deactivate the last active owner' });
      }
    }
    const { rows } = await db.query(`
      UPDATE users SET
        email     = COALESCE($1, email),
        name      = COALESCE($2, name),
        role      = COALESCE($3, role),
        is_active = COALESCE($4, is_active)
      WHERE id = $5
      RETURNING id, email, name, role, is_active, created_at
    `, [email ? email.toLowerCase().trim() : null, name ? name.trim() : null,
        role || null, typeof is_active === 'boolean' ? is_active : null, id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    // Drop the cached role so the change applies to their next request rather
    // than after the auth cache expires.
    protect.invalidateUser(id);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A user with that email already exists' });
    console.error('[users/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id/password — reset a user's password
router.put('/:id/password', protect, ownerOnly, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      'UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING id', [hash, parseInt(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[users/password]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/users/:id — delete (blocks self + last owner)
router.delete('/:id', protect, ownerOnly, async (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  try {
    const cur = (await db.query('SELECT role, is_active FROM users WHERE id=$1', [id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'User not found' });
    if (cur.role === 'owner') {
      const owners = (await db.query("SELECT COUNT(*)::int AS n FROM users WHERE role='owner' AND is_active=true")).rows[0].n;
      if (owners <= 1) return res.status(400).json({ error: 'Cannot delete the last active owner' });
    }
    await db.query('DELETE FROM users WHERE id=$1', [id]);
    protect.invalidateUser(id);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'User has linked records (e.g. uploaded documents). Deactivate instead.' });
    console.error('[users/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
