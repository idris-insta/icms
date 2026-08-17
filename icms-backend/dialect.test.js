#!/usr/bin/env node
/**
 * Unit tests for the PostgreSQL -> MariaDB SQL translator.
 * Run with:  node dialect.test.js
 */
const { toMysql, convertPlaceholders, extractReturning } = require('./src/db/dialect');

let failed = 0;
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function check(name, actual, mustContain = [], mustNotContain = []) {
  const a = norm(actual);
  const bad = [
    ...mustContain.filter(x => !a.includes(x)).map(x => `missing ${JSON.stringify(x)}`),
    ...mustNotContain.filter(x => a.includes(x)).map(x => `should not contain ${JSON.stringify(x)}`),
  ];
  if (bad.length) {
    failed++;
    console.log(`FAIL ${name}\n     ${bad.join('\n     ')}\n     got: ${a}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── reserved word quoting ────────────────────────────────────────────────────
check('settings upsert quotes the key column but not the KEY keyword',
  toMysql("INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,NOW()) " +
          "ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()"),
  ['ON DUPLICATE KEY UPDATE', '`key`'],
  ['ON DUPLICATE `key` UPDATE', 'ON CONFLICT']);

check('key quoted in a plain select',
  toMysql('SELECT key, value FROM settings ORDER BY key'),
  ['`key`'], ['ON CONFLICT']);

check('the word key inside a string literal is left alone',
  toMysql("SELECT * FROM documents WHERE doc_type = 'a key document'"),
  ["'a key document'"], ["'a `key` document'"]);

// ── aggregates / functions ───────────────────────────────────────────────────
check('COUNT(*) FILTER becomes a conditional sum',
  toMysql("SELECT COUNT(*) FILTER (WHERE status = 'Paid') AS n FROM import_orders"),
  ["SUM(CASE WHEN status = 'Paid' THEN 1 ELSE 0 END)"], ['FILTER']);

check('SUM(x) FILTER becomes a conditional sum',
  toMysql("SELECT SUM(total_value) FILTER (WHERE status = 'Paid') AS v FROM import_orders"),
  ['SUM(CASE WHEN', 'THEN total_value END)'], ['FILTER']);

check('date_trunc month',
  toMysql("SELECT date_trunc('month', etd) FROM import_orders"),
  ["DATE_FORMAT(etd, '%Y-%m-01')"], ['date_trunc']);

check('to_char format mapping',
  toMysql("SELECT to_char(m,'YYYY-MM') AS month FROM t"),
  ["DATE_FORMAT(m, '%Y-%m')"], ['to_char']);

check('interval literals',
  toMysql("SELECT 1 FROM t WHERE d >= CURRENT_DATE - INTERVAL '12 months'"),
  ['INTERVAL 12 MONTH'], ["INTERVAL '12 months'"]);

check('ILIKE becomes LIKE',
  toMysql('SELECT 1 FROM t WHERE po_number ILIKE $1'),
  ['LIKE'], ['ILIKE']);

check('casts are stripped, date casts kept',
  toMysql('SELECT COUNT(*)::int AS n, total_value::float AS v, etd::date AS d FROM t'),
  ['CAST(etd AS DATE)'], ['::int', '::float', '::date']);

check('NOW gains microsecond precision',
  toMysql('UPDATE t SET updated_at = NOW() WHERE id = $1'),
  ['NOW(6)']);

check('array_agg first-value idiom',
  toMysql('SELECT (array_agg(unit_price ORDER BY created_at DESC))[1]::float AS last_price FROM t'),
  ['GROUP_CONCAT', 'SUBSTRING_INDEX', 'CAST('], ['array_agg']);

check('ON CONFLICT DO NOTHING becomes INSERT IGNORE',
  toMysql('INSERT INTO import_orders (po_number) VALUES ($1) ON CONFLICT (po_number) DO NOTHING'),
  ['INSERT IGNORE INTO'], ['ON CONFLICT']);

check('EXCLUDED becomes VALUES()',
  toMysql('INSERT INTO skus (sku_code, brand) VALUES ($1,$2) ON CONFLICT (sku_code) DO UPDATE SET brand = EXCLUDED.brand'),
  ['ON DUPLICATE KEY UPDATE', 'VALUES(brand)'], ['EXCLUDED']);

check('NULLS LAST is dropped',
  toMysql('SELECT 1 FROM t ORDER BY x DESC NULLS LAST'),
  ['ORDER BY x DESC'], ['NULLS LAST']);

// ── placeholders ─────────────────────────────────────────────────────────────
(() => {
  const { sql, params } = convertPlaceholders(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON DUPLICATE KEY UPDATE value = $2',
    ['company_name', 'ICMS']);
  const ok = sql.includes('?') && !sql.includes('$1')
    && params.length === 3 && params[0] === 'company_name'
    && params[1] === 'ICMS' && params[2] === 'ICMS';
  console.log(`${ok ? 'ok  ' : 'FAIL'} repeated $n placeholders are expanded positionally`);
  if (!ok) { failed++; console.log('     got:', sql, JSON.stringify(params)); }
})();

// ── RETURNING ────────────────────────────────────────────────────────────────
(() => {
  const r = extractReturning('UPDATE t SET a = $1 WHERE id = $2 RETURNING *');
  const ok = r.returning === '*' && !/RETURNING/i.test(r.sql);
  console.log(`${ok ? 'ok  ' : 'FAIL'} RETURNING is split off the statement`);
  if (!ok) failed++;
})();

console.log(failed ? `\n${failed} FAILURE(S)` : '\nall dialect tests passed');
process.exit(failed ? 1 : 0);
