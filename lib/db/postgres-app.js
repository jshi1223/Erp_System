const { Pool } = require('pg');
const { loadEnv } = require('../load-env');

loadEnv();

function createPostgresAppPool(options = {}) {
  const connectionString = options.connectionString || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required.');
  }

  const pool = new Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX || 5),
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
  });

  return new PostgresAppPool(pool);
}

class PostgresAppPool {
  constructor(pool) {
    this.pool = pool;
    this.isPostgres = true;
  }

  query(sql, params, callback) {
    const normalized = normalizeQueryArgs(params, callback);
    return runQuery(this.pool, sql, normalized.params, normalized.callback);
  }

  getConnection(callback) {
    this.pool.connect((err, client) => {
      if (err) return callback(err);
      callback(null, new PostgresAppConnection(client));
    });
  }

  end(callback) {
    return this.pool.end(callback);
  }
}

class PostgresAppConnection {
  constructor(client) {
    this.client = client;
    this.isPostgres = true;
  }

  query(sql, params, callback) {
    const normalized = normalizeQueryArgs(params, callback);
    return runQuery(this.client, sql, normalized.params, normalized.callback);
  }

  beginTransaction(callback) {
    this.client.query('BEGIN', callback);
  }

  commit(callback) {
    this.client.query('COMMIT', callback);
  }

  rollback(callback) {
    this.client.query('ROLLBACK', callback);
  }

  release() {
    this.client.release();
  }
}

function normalizeQueryArgs(params, callback) {
  if (typeof params === 'function') {
    return { params: [], callback: params };
  }
  return { params: Array.isArray(params) ? params : [], callback };
}

function runQuery(client, sourceSql, params = [], callback) {
  const prepared = preparePostgresQuery(sourceSql, params);
  const promise = client.query(prepared.sql, prepared.params).then((result) => {
    const payload = toCallbackResult(prepared.sql, result);
    if (typeof callback === 'function') callback(null, payload, result.fields);
    return payload;
  }).catch((err) => {
    if (isIgnorablePostgresDdl(err, prepared.sql)) {
      const payload = { affectedRows: 0, changedRows: 0, insertId: 0 };
      if (typeof callback === 'function') callback(null, payload, []);
      return payload;
    }
    if (typeof callback === 'function') {
      callback(err);
      return null;
    }
    throw err;
  });

  return promise;
}

function preparePostgresQuery(sourceSql, params) {
  let sql = String(sourceSql || '').trim();
  const coercedParams = coerceBooleanParams(sql, params);

  if (/^\s*INSERT\s+INTO\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) {
    sql = `${sql} RETURNING id`;
  }

  return {
    sql: replaceQuestionPlaceholders(sql),
    params: coercedParams,
  };
}

function replaceQuestionPlaceholders(sql) {
  let index = 0;
  let out = '';
  let quote = null;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (quote) {
      out += ch;
      if (ch === quote && next !== quote) quote = null;
      if (ch === quote && next === quote) {
        out += next;
        i += 1;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === '?') {
      index += 1;
      out += `$${index}`;
      continue;
    }

    out += ch;
  }

  return out;
}

const booleanColumns = new Set([
  'active',
  'archived',
  'archived_auto',
  'is_active',
  'is_archived',
  'is_closed',
  'is_default',
]);

function coerceBooleanParams(sql, params) {
  if (!Array.isArray(params) || params.length === 0) return params;

  const next = params.slice();
  const insertColumns = getInsertColumns(sql);
  let placeholderIndex = 0;
  let quote = null;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const following = sql[i + 1];

    if (quote) {
      if (ch === quote && following !== quote) quote = null;
      if (ch === quote && following === quote) i += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (ch !== '?') continue;

    const columnFromInsert = insertColumns[placeholderIndex];
    const before = sql.slice(Math.max(0, i - 120), i);
    const columnMatch = before.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|<>|!=)\s*$/);
    const column = String(columnFromInsert || columnMatch?.[1] || '').toLowerCase();

    if (booleanColumns.has(column)) {
      next[placeholderIndex] = coerceBooleanValue(next[placeholderIndex]);
    }

    placeholderIndex += 1;
  }

  return next;
}

function getInsertColumns(sql) {
  const match = String(sql || '').match(/^\s*INSERT\s+INTO\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (!match) return [];

  const columns = match[1].split(',').map((column) => column.trim().replace(/"/g, '').toLowerCase());
  const values = match[2].split(',').map((value) => value.trim());
  const mapped = [];
  values.forEach((value, index) => {
    if (value === '?') mapped.push(columns[index] || '');
  });
  return mapped;
}

function coerceBooleanValue(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return value;
}

function toCallbackResult(sql, result) {
  if (/^\s*SELECT\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
    if (/^\s*INSERT\b/i.test(sql)) {
      if (result.rows?.[0] && result.rows[0].id === undefined) {
        return result.rows;
      }
      return {
        insertId: Number(result.rows?.[0]?.id || 0) || 0,
        affectedRows: result.rowCount || 0,
      };
    }
    return result.rows || [];
  }

  return {
    affectedRows: result.rowCount || 0,
    changedRows: result.rowCount || 0,
    insertId: Number(result.rows?.[0]?.id || 0) || 0,
  };
}

function isIgnorablePostgresDdl(err, sql) {
  const code = String(err?.code || '');
  if (!['42P07', '42701', '42710'].includes(code)) return false;
  return /^\s*(?:ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|CREATE\s+TABLE)/i.test(String(sql || ''));
}

module.exports = {
  createPostgresAppPool,
  replaceQuestionPlaceholders,
};
