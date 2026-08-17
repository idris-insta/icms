/**
 * PostgreSQL -> MariaDB/MySQL SQL dialect translator.
 *
 * The app's SQL was written for Postgres. Rather than hand-porting ~370 sites
 * (and losing the ability to run against Postgres), we translate at the driver
 * boundary. Everything here is mechanical and paren-aware; the handful of
 * constructs that cannot be translated safely (LATERAL, DISTINCT ON, jsonb `?`)
 * were rewritten by hand in the route files instead.
 */

/** Find the index of the ')' matching the '(' at `open`. Skips string literals. */
function matchParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {                       // skip a single-quoted literal
      i++;
      while (i < s.length && !(s[i] === "'" && s[i - 1] !== '\\')) i++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Split on top-level commas (ignoring nested parens and string literals). */
function splitArgs(s) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { i++; while (i < s.length && !(s[i] === "'" && s[i - 1] !== '\\')) i++; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.map(x => x.trim());
}

/** Apply `fn` to the parts of `s` that sit outside single-quoted literals. */
function outsideLiterals(s, fn) {
  let out = '', buf = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "'") {
      out += fn(buf); buf = '';
      const start = i++;
      while (i < s.length && !(s[i] === "'" && s[i - 1] !== '\\')) i++;
      out += s.slice(start, i + 1);
      continue;
    }
    buf += s[i];
  }
  return out + fn(buf);
}

/** Rewrite every `<fn>(...)` occurrence using `fn(argsString) -> replacement`. */
function rewriteCalls(sql, name, fn) {
  const re = new RegExp(`\\b${name}\\s*\\(`, 'i');
  let out = sql, guard = 0;
  for (;;) {
    if (++guard > 200) break;
    const m = re.exec(out);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    const close = matchParen(out, open);
    if (close < 0) break;
    const inner = out.slice(open + 1, close);
    out = out.slice(0, m.index) + fn(inner) + out.slice(close + 1);
  }
  return out;
}

// ── aggregate FILTER (WHERE …) → conditional aggregate ───────────────────────
function convertFilter(sql) {
  const re = /\bFILTER\s*\(\s*WHERE\b/i;
  let out = sql, guard = 0;
  for (;;) {
    if (++guard > 200) break;
    const m = re.exec(out);
    if (!m) break;
    const open = out.indexOf('(', m.index);
    const close = matchParen(out, open);
    if (close < 0) break;
    const cond = out.slice(out.toUpperCase().indexOf('WHERE', open) + 5, close).trim();

    // Walk back over whitespace to the aggregate's closing paren.
    let j = m.index - 1;
    while (j >= 0 && /\s/.test(out[j])) j--;
    if (out[j] !== ')') break;
    const aggClose = j;
    let depth = 0, aggOpen = -1;
    for (let i = aggClose; i >= 0; i--) {
      if (out[i] === ')') depth++;
      else if (out[i] === '(') { depth--; if (depth === 0) { aggOpen = i; break; } }
    }
    if (aggOpen < 0) break;
    let k = aggOpen - 1;
    while (k >= 0 && /\s/.test(out[k])) k--;
    let nameEnd = k + 1;
    while (k >= 0 && /[A-Za-z0-9_]/.test(out[k])) k--;
    const aggStart = k + 1;
    const aggName = out.slice(aggStart, nameEnd).toUpperCase();
    const aggArgs = out.slice(aggOpen + 1, aggClose).trim();

    let replacement;
    if (aggName === 'COUNT' && aggArgs === '*') {
      replacement = `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END)`;
    } else if (aggName === 'COUNT') {
      replacement = `COUNT(CASE WHEN ${cond} THEN ${aggArgs} END)`;
    } else {
      replacement = `${aggName}(CASE WHEN ${cond} THEN ${aggArgs} END)`;
    }
    out = out.slice(0, aggStart) + replacement + out.slice(close + 1);
  }
  return out;
}

// ── to_char format string → MySQL DATE_FORMAT ────────────────────────────────
const FMT = [
  ['YYYY', '%Y'], ['MM', '%m'], ['DD', '%d'],
  ['HH24', '%H'], ['HH', '%h'], ['MI', '%i'], ['SS', '%s'],
  ['Mon', '%b'], ['Day', '%W'],
];
function pgFormatToMysql(fmt) {
  let out = fmt;
  for (const [pg, my] of FMT) out = out.split(pg).join(my);
  return out;
}

/**
 * Translate a Postgres statement to MariaDB.
 * Returns the translated SQL; parameter placeholders are handled separately.
 */
function toMysql(sql) {
  let s = sql;

  // (array_agg(x ORDER BY y))[1] — the "first/last value in group" idiom.
  // GROUP_CONCAT with a rare separator, then take the first element.
  const SEP = '\\u001f';
  s = s.replace(
    /\(\s*array_agg\s*\(([\s\S]*?)\)\s*\)\s*\[\s*1\s*\]\s*::\s*(float|numeric|int|integer)/gi,
    (_m, inner) => `CAST(SUBSTRING_INDEX(GROUP_CONCAT(${inner} SEPARATOR '${SEP}'), '${SEP}', 1) AS DECIMAL(24,6))`
  );
  s = s.replace(
    /\(\s*array_agg\s*\(([\s\S]*?)\)\s*\)\s*\[\s*1\s*\]/gi,
    (_m, inner) => `SUBSTRING_INDEX(GROUP_CONCAT(${inner} SEPARATOR '${SEP}'), '${SEP}', 1)`
  );

  // string_agg(expr, sep) -> GROUP_CONCAT(expr SEPARATOR sep)
  s = rewriteCalls(s, 'string_agg', (inner) => {
    const a = splitArgs(inner);
    return a.length >= 2
      ? `GROUP_CONCAT(${a[0]} SEPARATOR ${a[1]})`
      : `GROUP_CONCAT(${inner})`;
  });

  // date_trunc('unit', expr)
  s = rewriteCalls(s, 'date_trunc', (inner) => {
    const a = splitArgs(inner);
    const unit = (a[0] || '').replace(/'/g, '').toLowerCase();
    const e = a[1] || 'NOW()';
    if (unit === 'month')   return `DATE_FORMAT(${e}, '%Y-%m-01')`;
    if (unit === 'year')    return `DATE_FORMAT(${e}, '%Y-01-01')`;
    if (unit === 'day')     return `DATE(${e})`;
    if (unit === 'week')    return `DATE_SUB(DATE(${e}), INTERVAL WEEKDAY(${e}) DAY)`;
    if (unit === 'quarter') return `MAKEDATE(YEAR(${e}),1) + INTERVAL (QUARTER(${e})-1) QUARTER`;
    return `DATE(${e})`;
  });

  // to_char(expr, 'FMT')
  s = rewriteCalls(s, 'to_char', (inner) => {
    const a = splitArgs(inner);
    if (a.length < 2) return `CAST(${inner} AS CHAR)`;
    const fmt = a[1].replace(/^'|'$/g, '');
    return `DATE_FORMAT(${a[0]}, '${pgFormatToMysql(fmt)}')`;
  });

  // INTERVAL '12 months' -> INTERVAL 12 MONTH
  s = s.replace(/INTERVAL\s+'(\d+)\s*(day|days|month|months|year|years|hour|hours|week|weeks|minute|minutes)'/gi,
    (_m, n, unit) => `INTERVAL ${n} ${unit.replace(/s$/i, '').toUpperCase()}`);

  // Casts. Postgres uses these mostly to force numeric output types, which
  // MariaDB does natively — dropping them is safe. ::date is kept as a real
  // CAST because date arithmetic depends on it.
  s = s.replace(/::\s*date\b/gi, '__CASTDATE__');
  s = s.replace(/::\s*(float8|float|numeric|decimal|int8|int4|integer|int|bigint|text|jsonb|json|boolean|bool)\b/gi, '');
  // Apply the deferred ::date casts: wrap the immediately-preceding operand.
  s = applyDateCasts(s);

  // ORDER BY … NULLS LAST/FIRST — MariaDB has no such clause.
  s = s.replace(/\s+NULLS\s+(LAST|FIRST)\b/gi, '');

  // ON CONFLICT (...) DO UPDATE SET x = ..., y = ...
  s = s.replace(/\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\b/gi, 'ON DUPLICATE KEY UPDATE');
  s = s.replace(/\bON\s+CONFLICT\s+ON\s+CONSTRAINT\s+\w+\s*DO\s+UPDATE\s+SET\b/gi, 'ON DUPLICATE KEY UPDATE');
  // EXCLUDED.col -> VALUES(col)
  s = s.replace(/\bEXCLUDED\.([A-Za-z0-9_]+)/gi, 'VALUES($1)');
  // ON CONFLICT ... DO NOTHING -> INSERT IGNORE
  if (/\bON\s+CONFLICT\b[\s\S]*\bDO\s+NOTHING\b/i.test(s)) {
    s = s.replace(/\bON\s+CONFLICT\s*(\([^)]*\)|ON\s+CONSTRAINT\s+\w+)?\s*DO\s+NOTHING\b/gi, '');
    s = s.replace(/^(\s*)INSERT\s+INTO\b/i, '$1INSERT IGNORE INTO');
  }

  // Aggregate FILTER clauses.
  s = convertFilter(s);

  // ILIKE has no MariaDB equivalent; LIKE is already case-insensitive under the
  // schema's utf8mb4_general_ci collation.
  s = s.replace(/\bILIKE\b/gi, 'LIKE');

  // NOW() in MariaDB truncates to whole seconds, unlike PostgreSQL's
  // microsecond now(). updated_at is used as an optimistic-concurrency token,
  // so the extra precision is load-bearing, not cosmetic.
  s = s.replace(/\bNOW\s*\(\s*\)/gi, 'NOW(6)');
  s = s.replace(/\bCURRENT_TIMESTAMP\b(?!\s*\()/gi, 'CURRENT_TIMESTAMP(6)');

  // Boolean literals in join conditions: `ON true` is valid in MariaDB, leave.
  // Reserved words that are column names in this schema. Quoting is applied
  // outside string literals only, so a query whose text happens to contain the
  // word inside quotes is left alone.
  // Case-sensitive on purpose: the column is lowercase `key`, while the SQL
  // keyword in `ON DUPLICATE KEY UPDATE` is upper case and must not be quoted.
  s = outsideLiterals(s, (chunk) => chunk.replace(/(?<![`."\w])\bkey\b(?!\s*\()/g, '`key`'));

  return s;
}

/** `X::date` → `CAST(X AS DATE)`; operand is the preceding token/paren group. */
function applyDateCasts(s) {
  let out = s, guard = 0;
  for (;;) {
    if (++guard > 200) break;
    const idx = out.indexOf('__CASTDATE__');
    if (idx < 0) break;
    let j = idx - 1;
    while (j >= 0 && /\s/.test(out[j])) j--;
    let start;
    if (out[j] === ')') {
      let depth = 0;
      for (let i = j; i >= 0; i--) {
        if (out[i] === ')') depth++;
        else if (out[i] === '(') { depth--; if (depth === 0) { start = i; break; } }
      }
      // include a function name in front of the paren, if any
      let k = start - 1;
      while (k >= 0 && /[A-Za-z0-9_]/.test(out[k])) k--;
      start = k + 1;
    } else {
      let k = j;
      while (k >= 0 && /[A-Za-z0-9_$.]/.test(out[k])) k--;
      start = k + 1;
    }
    const operand = out.slice(start, j + 1);
    out = out.slice(0, start) + `CAST(${operand} AS DATE)` + out.slice(idx + '__CASTDATE__'.length);
  }
  return out;
}

/**
 * Convert `$1 $2 …` placeholders to `?` and reorder/duplicate the parameter
 * array to match, since Postgres allows a placeholder to appear many times.
 */
function convertPlaceholders(sql, params) {
  if (!params || !params.length) return { sql: sql.replace(/\$\d+/g, '?'), params: params || [] };
  const out = [];
  const text = sql.replace(/\$(\d+)/g, (_m, n) => {
    out.push(params[parseInt(n, 10) - 1]);
    return '?';
  });
  return { sql: text, params: out.length ? out : params };
}

/** Strip a trailing RETURNING clause; report what it asked for. */
function extractReturning(sql) {
  const m = /\bRETURNING\b([\s\S]*)$/i.exec(sql);
  if (!m) return { sql, returning: null };
  return { sql: sql.slice(0, m.index).trim(), returning: m[1].trim() };
}

module.exports = { toMysql, convertPlaceholders, extractReturning, matchParen, splitArgs };
