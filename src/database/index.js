// Database layer: the app's PostgreSQL pool (mysql-compatible wrapper), the queryAsync
// promise helper, and the Postgres error-code helpers. Everything else in the codebase
// imports `db` / `queryAsync` from here instead of redefining them.
//
// Extracted from server.js (step 1 of the backend modularization — see src/ARCHITECTURE.md).
const { createPostgresAppPool } = require('../../lib/db/postgres-app');

const db = createPostgresAppPool();

function queryAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function isPostgresUniqueViolation(err) {
  return String(err?.code || '') === '23505';
}

function isPostgresUndefinedTable(err) {
  return String(err?.code || '') === '42P01';
}

function isPostgresUndefinedColumn(err) {
  return String(err?.code || '') === '42703';
}

function isPostgresDuplicateObject(err) {
  const code = String(err?.code || '');
  return ['42P07', '42701', '42710'].includes(code)
    || /already exists|duplicate/i.test(String(err?.message || ''));
}

module.exports = {
  db,
  queryAsync,
  isPostgresUniqueViolation,
  isPostgresUndefinedTable,
  isPostgresUndefinedColumn,
  isPostgresDuplicateObject,
};
