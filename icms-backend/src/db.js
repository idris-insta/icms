const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis:       30000,
  max:                     10,
});

// Log DB errors but DON'T exit the process
pool.on('error', (err) => {
  console.error('[DB] Pool client error (non-fatal):', normalizeErr(err));
});

/** Normalise AggregateError / ECONNREFUSED into a readable string */
function normalizeErr(err) {
  if (!err) return 'Unknown DB error';
  if (err.message) return err.message;
  if (err.code === 'ECONNREFUSED' || err.constructor?.name === 'AggregateError') {
    return 'Database connection refused — ensure PostgreSQL/Docker is running.';
  }
  return err.toString() || 'Unknown DB error';
}

/** Wraps pool.query and always throws errors with a proper .message */
async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    const msg = normalizeErr(err);
    const wrapped = new Error(msg);
    wrapped.code = err.code;
    wrapped.detail = err.detail;
    throw wrapped;
  }
}

module.exports = { query, pool };
