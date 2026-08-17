/**
 * Database access layer.
 *
 * Speaks to a MariaDB/MySQL *server* by default (DB_CLIENT=mysql) and can still
 * run against PostgreSQL (DB_CLIENT=pg) so a deployment can be rolled back.
 *
 * Route code keeps writing Postgres-flavoured SQL with `$1` placeholders and
 * `RETURNING`; this module translates it. See src/db/dialect.js.
 *
 * Config (mysql):  DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
 *                  or a single DATABASE_URL (mysql://user:pass@host:port/db)
 * Config (pg):     DATABASE_URL
 */

const { toMysql, convertPlaceholders, extractReturning } = require('./db/dialect');

const CLIENT = (process.env.DB_CLIENT || 'mysql').toLowerCase();
const isMysql = CLIENT === 'mysql' || CLIENT === 'mariadb';

let pool;

/* ─────────────────────────── PostgreSQL backend ─────────────────────────── */

function initPg() {
  const { Pool } = require('pg');
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 10,
  });
}

/* ──────────────────────── MariaDB / MySQL backend ───────────────────────── */

function mysqlConfig() {
  const url = process.env.DATABASE_URL;
  const base = {
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_POOL_MAX || '10', 10),
    queueLimit: 0,
    connectTimeout: 10000,
    charset: 'utf8mb4_general_ci',
    timezone: 'Z',
    decimalNumbers: true,   // DECIMAL as JS number, matching the old ::float casts
    supportBigNumbers: true,
    multipleStatements: false,
    namedPlaceholders: false,
  };
  if (url && /^mysql:\/\//i.test(url)) {
    const u = new URL(url);
    return {
      ...base,
      host: u.hostname,
      port: parseInt(u.port || '3306', 10),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  }
  return {
    ...base,
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'icms_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'icms',
  };
}

function initMysql() {
  const mysql = require('mysql2/promise');
  const p = mysql.createPool(mysqlConfig());

  // MariaDB defaults to REPEATABLE READ; this application was written against
  // PostgreSQL, whose default is READ COMMITTED. The difference is not cosmetic:
  // under REPEATABLE READ a transaction that waits on a row lock still reads
  // from the snapshot it took before waiting, so "lock the supplier row, then
  // read MAX(po sequence)" would hand two concurrent requests the same number.
  // Matching PostgreSQL's isolation keeps the existing logic correct.
  p.on('connection', (conn) => {
    conn.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED', (err) => {
      if (err) console.error('[DB] could not set READ COMMITTED:', err.message);
    });
  });
  return p;
}

pool = isMysql ? initMysql() : initPg();

if (!isMysql) {
  pool.on('error', (err) => console.error('[DB] Pool client error (non-fatal):', normalizeErr(err)));
}

/* ────────────────────────────── error shaping ───────────────────────────── */

function normalizeErr(err) {
  if (!err) return 'Unknown DB error';
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.constructor?.name === 'AggregateError') {
    return `Database connection refused — ensure the ${isMysql ? 'MariaDB' : 'PostgreSQL'} server is reachable.`;
  }
  if (err.message) return err.message;
  return err.toString() || 'Unknown DB error';
}

function wrap(err) {
  // Errors the route threw deliberately (with an HTTP status) pass through
  // untouched — re-wrapping them would strip the status and turn an intended
  // 400/404 into a 500.
  if (err && err.status) return err;
  const e = new Error(normalizeErr(err));
  e.code = err.code;
  e.detail = err.detail || err.sqlMessage;
  // Normalise the unique-violation code so routes can keep checking for 23505.
  if (err.code === 'ER_DUP_ENTRY') e.code = '23505';
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') e.code = '23503';
  return e;
}

/* ─────────────────── RETURNING emulation for MariaDB ────────────────────── */

/** Split an UPDATE/DELETE at its top-level WHERE, honouring parens and strings. */
function splitWhere(sql) {
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") { i++; while (i < sql.length && !(sql[i] === "'" && sql[i - 1] !== '\\')) i++; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && /\s/.test(c) && /^where\b/i.test(sql.slice(i + 1, i + 7))) {
      return { head: sql.slice(0, i), where: sql.slice(i + 1) };
    }
  }
  return { head: sql, where: null };
}

const countQ = (s) => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { i++; while (i < s.length && !(s[i] === "'" && s[i - 1] !== '\\')) i++; continue; }
    if (c === '?') n++;
  }
  return n;
};

const tableOf = (sql, kind) => {
  const re = kind === 'insert' ? /\bINSERT\s+(?:IGNORE\s+)?INTO\s+([`\w.]+)/i
    : kind === 'update' ? /\bUPDATE\s+([`\w.]+)/i
      : /\bDELETE\s+FROM\s+([`\w.]+)/i;
  const m = re.exec(sql);
  return m ? m[1] : null;
};

/**
 * Run a statement that carried a RETURNING clause. MariaDB only supports
 * RETURNING on INSERT/DELETE (and not at all before 10.5), so we emulate it
 * with an extra SELECT on the *same* connection.
 */
async function runReturning(conn, sql, params, returning) {
  const cols = returning === '*' ? '*' : returning;

  if (/^\s*INSERT\b/i.test(sql)) {
    const table = tableOf(sql, 'insert');
    // Make LAST_INSERT_ID() correct even when the row already existed.
    let stmt = sql;
    if (/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.test(stmt) && !/LAST_INSERT_ID\s*\(\s*id\s*\)/i.test(stmt)) {
      stmt = stmt.replace(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i, 'ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id),');
    }
    const [res] = await conn.query(stmt, params);
    if (!res.affectedRows) return { rows: [], rowCount: 0 };
    const [rows] = await conn.query(`SELECT ${cols} FROM ${table} WHERE id = LAST_INSERT_ID()`);
    return { rows, rowCount: rows.length };
  }

  if (/^\s*UPDATE\b/i.test(sql)) {
    const table = tableOf(sql, 'update');
    const { head, where } = splitWhere(sql);
    if (!where) {
      await conn.query(sql, params);
      const [rows] = await conn.query(`SELECT ${cols} FROM ${table}`);
      return { rows, rowCount: rows.length };
    }
    const nHead = countQ(head);
    const whereParams = params.slice(nHead);
    // Capture the target ids first: the WHERE clause may match on a column the
    // UPDATE is about to change.
    const [ids] = await conn.query(`SELECT id FROM ${table} ${where}`, whereParams);
    await conn.query(sql, params);
    if (!ids.length) return { rows: [], rowCount: 0 };
    const list = ids.map(r => r.id);
    const [rows] = await conn.query(
      `SELECT ${cols} FROM ${table} WHERE id IN (${list.map(() => '?').join(',')})`, list);
    return { rows, rowCount: rows.length };
  }

  if (/^\s*DELETE\b/i.test(sql)) {
    const table = tableOf(sql, 'delete');
    const { where } = splitWhere(sql);
    const [rows] = where
      ? await conn.query(`SELECT ${cols} FROM ${table} ${where}`, params)
      : await conn.query(`SELECT ${cols} FROM ${table}`);
    await conn.query(sql, params);
    return { rows, rowCount: rows.length };
  }

  const [rows] = await conn.query(sql, params);
  return { rows: Array.isArray(rows) ? rows : [], rowCount: res_rowCount(rows) };
}

const res_rowCount = (r) => (Array.isArray(r) ? r.length : (r?.affectedRows ?? 0));

/* ─────────────────────────── JSON column hydration ──────────────────────── */

// PostgreSQL's jsonb columns arrive already parsed; MariaDB stores JSON as text
// and hands back a string. The routes and the UI treat these as objects/arrays
// (spreading doc_checklist, mapping over tracking_updates), so parse them here
// rather than at every call site.
const JSON_COLUMNS = new Set(['doc_checklist', 'tracking_updates']);

function hydrateJson(rows) {
  if (!Array.isArray(rows)) return rows;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const col of JSON_COLUMNS) {
      const v = row[col];
      if (typeof v !== 'string') continue;
      try {
        row[col] = JSON.parse(v);
      } catch {
        // Not valid JSON (legacy or hand-edited row) — leave a usable default
        // instead of a string the caller would spread character by character.
        row[col] = col === 'tracking_updates' ? [] : {};
      }
    }
  }
  return rows;
}

/* ──────────────────────────────── query() ───────────────────────────────── */

/** Prepare a Postgres-flavoured statement for MariaDB. */
function prepare(text, params) {
  const translated = toMysql(text);
  const { sql: withReturn, returning } = extractReturning(translated);
  const conv = convertPlaceholders(withReturn, params);
  return { sql: conv.sql, params: conv.params, returning };
}

async function mysqlExec(runner, text, params) {
  const p = prepare(text, params);
  if (p.returning) {
    const out = await runReturning(runner, p.sql, p.params, p.returning);
    return { ...out, rows: hydrateJson(out.rows) };
  }
  const [rows] = await runner.query(p.sql, p.params);
  return Array.isArray(rows)
    ? { rows: hydrateJson(rows), rowCount: rows.length }
    : { rows: [], rowCount: rows.affectedRows ?? 0, insertId: rows.insertId };
}

/**
 * Execute a statement. Always resolves to `{ rows, rowCount }` regardless of
 * the underlying driver.
 */
async function query(text, params) {
  try {
    if (!isMysql) return await pool.query(text, params);
    if (/\bRETURNING\b/i.test(text)) {
      // Needs several statements on one connection.
      const conn = await pool.getConnection();
      try { return await mysqlExec(conn, text, params); }
      finally { conn.release(); }
    }
    return await mysqlExec(pool, text, params);
  } catch (err) {
    throw wrap(err);
  }
}

/**
 * Run `fn` inside a transaction. `fn` receives an object with the same
 * `query(text, params)` signature. Rolls back on throw.
 *
 * Use this wherever a request performs a read-then-write or writes to more
 * than one table — it is what keeps concurrent requests from interleaving.
 */
async function tx(fn) {
  if (!isMysql) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn({ query: (t, p) => client.query(t, p) });
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
      throw wrap(err);
    } finally {
      client.release();
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn({ query: (t, p) => mysqlExec(conn, t, p) });
    await conn.commit();
    return out;
  } catch (err) {
    try { await conn.rollback(); } catch { /* connection already gone */ }
    throw wrap(err);
  } finally {
    conn.release();
  }
}

/** True once the server answers. Used by the /health endpoint and boot check. */
async function ping() {
  await query('SELECT 1');
  return true;
}

module.exports = { query, tx, ping, pool, isMysql, CLIENT, prepare };
