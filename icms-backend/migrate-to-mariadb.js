#!/usr/bin/env node
/**
 * One-shot data migration: PostgreSQL -> MariaDB.
 *
 *   PG_URL=postgresql://icms_user:pass@localhost:5433/icms \
 *   DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=icms \
 *   node migrate-to-mariadb.js [--truncate]
 *
 * Copies every row, preserving primary keys so foreign keys stay intact.
 * Tables are copied parents-first. Re-runnable: rows are INSERTed with
 * ON DUPLICATE KEY UPDATE so an interrupted run can simply be repeated.
 */

require('dotenv').config();
const { Pool } = require('pg');
const mysql = require('mysql2/promise');

const TRUNCATE = process.argv.includes('--truncate');

// Parent tables first — FK order matters.
const TABLES = [
  'users', 'suppliers', 'skus', 'ports',
  'order_schedules', 'import_orders', 'order_items',
  'payments', 'documents', 'settings',
];

// Columns holding JSON. Postgres hands back parsed objects; MariaDB wants text.
const JSON_COLS = new Set(['tracking_updates', 'doc_checklist']);

const pg = new Pool({ connectionString: process.env.PG_URL || process.env.DATABASE_URL });

function myConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'icms_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'icms',
    charset: 'utf8mb4_general_ci',
    timezone: 'Z',
    multipleStatements: false,
  };
}

/** Coerce a pg value into something mysql2 will bind correctly. */
function coerce(col, v) {
  if (v === null || v === undefined) return null;
  if (JSON_COLS.has(col) && typeof v === 'object') return JSON.stringify(v);
  if (v instanceof Date) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

async function copyTable(my, table) {
  const { rows } = await pg.query(`SELECT * FROM ${table}`);
  if (!rows.length) { console.log(`  ${table.padEnd(16)} 0 rows`); return 0; }

  const cols = Object.keys(rows[0]);
  const quoted = cols.map(c => `\`${c}\``).join(', ');
  const marks = cols.map(() => '?').join(', ');
  // Idempotent: re-running updates rather than erroring on the PK.
  const upd = cols.map(c => `\`${c}\` = VALUES(\`${c}\`)`).join(', ');
  const sql = `INSERT INTO \`${table}\` (${quoted}) VALUES (${marks}) ON DUPLICATE KEY UPDATE ${upd}`;

  let n = 0;
  for (const r of rows) {
    await my.execute(sql, cols.map(c => coerce(c, r[c])));
    n++;
  }
  console.log(`  ${table.padEnd(16)} ${n} rows`);
  return n;
}

/** Push each AUTO_INCREMENT past the highest copied id. */
async function fixAutoIncrement(my, table) {
  const [[{ mx }]] = await my.query(`SELECT COALESCE(MAX(id), 0) AS mx FROM \`${table}\``);
  if (mx > 0) await my.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = ${mx + 1}`);
}

(async () => {
  const my = await mysql.createConnection(myConfig());
  try {
    await my.query('SET FOREIGN_KEY_CHECKS = 0');

    if (TRUNCATE) {
      console.log('Truncating target tables…');
      for (const t of [...TABLES].reverse()) await my.query(`DELETE FROM \`${t}\``);
    }

    console.log(`Copying ${TABLES.length} tables from PostgreSQL to MariaDB…`);
    let total = 0;
    for (const t of TABLES) total += await copyTable(my, t);

    for (const t of TABLES) {
      if (t !== 'settings') await fixAutoIncrement(my, t);
    }

    await my.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`\nDone — ${total} rows migrated.`);

    // Verify: row counts must match on both sides.
    console.log('\nVerifying row counts:');
    let bad = 0;
    for (const t of TABLES) {
      const [[{ n: a }]] = await my.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      const { rows: [{ n: b }] } = await pg.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
      const ok = Number(a) === Number(b);
      if (!ok) bad++;
      console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${t.padEnd(16)} mariadb=${a} postgres=${b}`);
    }
    if (bad) { console.error(`\n${bad} table(s) do not match.`); process.exitCode = 1; }
  } catch (err) {
    console.error('\nMigration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await my.end();
    await pg.end();
  }
})();
