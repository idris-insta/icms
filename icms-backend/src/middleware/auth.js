const jwt = require('jsonwebtoken');
const db  = require('../db');

// Tokens live for 7 days and carry the role they were minted with. Without a
// re-check, deactivating a user or demoting an owner would not take effect
// until their token expired. Re-reading every request would add a query to
// every call, so the result is cached briefly: role changes take effect within
// TTL_MS rather than a week.
const TTL_MS = 30_000;
const cache = new Map();   // id -> { role, is_active, at }

function prune(now) {
  if (cache.size < 1000) return;
  for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
}

async function currentUser(id) {
  const now = Date.now();
  const hit = cache.get(id);
  if (hit && now - hit.at < TTL_MS) return hit;
  const { rows } = await db.query('SELECT role, is_active FROM users WHERE id = $1', [id]);
  const rec = rows[0]
    ? { role: rows[0].role, is_active: !!rows[0].is_active, at: now }
    : { role: null, is_active: false, at: now };
  cache.set(id, rec);
  prune(now);
  return rec;
}

/** Invalidate a user immediately after their role or status is changed. */
function invalidateUser(id) {
  cache.delete(Number(id));
  cache.delete(String(id));
}

module.exports = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let claims;
  try {
    claims = jwt.verify(header.slice(7), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const live = await currentUser(claims.id);
    if (!live.is_active) {
      return res.status(401).json({ error: 'Account inactive or not found' });
    }
    // Trust the database for the role, not the (possibly stale) token.
    req.user = { ...claims, role: live.role };
    next();
  } catch (err) {
    // Fail closed: without a role lookup the request cannot be authorised.
    console.error('[auth] role check failed:', err.message);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  }
};

module.exports.invalidateUser = invalidateUser;
