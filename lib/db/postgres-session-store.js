'use strict';

const session = require('express-session');
const { Pool } = require('pg');

function createPostgresSessionStore(options = {}) {
  const connectionString = options.connectionString || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for PostgreSQL sessions.');
  }

  const pool = options.pool || new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined
  });

  return new PostgresSessionStore({ ...options, pool });
}

class PostgresSessionStore extends session.Store {
  constructor({
    pool,
    tableName = 'app_sessions',
    ttlMs = 24 * 60 * 60 * 1000,
    cleanupIntervalMs = 15 * 60 * 1000
  } = {}) {
    super();
    if (!pool) throw new Error('PostgreSQL session store requires a pool.');

    this.pool = pool;
    this.tableName = quoteIdentifier(tableName);
    this.ttlMs = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0
      ? Number(ttlMs)
      : 24 * 60 * 60 * 1000;
    this.ready = this.ensureTable();

    const interval = Number(cleanupIntervalMs);
    if (Number.isFinite(interval) && interval > 0) {
      this.cleanupTimer = setInterval(() => {
        this.pruneExpiredSessions().catch((err) => this.emit('disconnect', err));
      }, interval);
      if (typeof this.cleanupTimer.unref === 'function') this.cleanupTimer.unref();
    }
  }

  async ensureTable() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        sid varchar(128) PRIMARY KEY,
        sess jsonb NOT NULL,
        expire timestamptz NOT NULL
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ${this.tableName.replace(/"/g, '')}_expire_idx
      ON ${this.tableName} (expire)
    `);
  }

  get(sid, callback) {
    this.ready
      .then(() => this.pool.query(
        `SELECT sess FROM ${this.tableName} WHERE sid = $1 AND expire > NOW() LIMIT 1`,
        [sid]
      ))
      .then((result) => {
        callback(null, result.rows[0]?.sess || null);
      })
      .catch((err) => callback(err));
  }

  set(sid, sess, callback = () => {}) {
    const expiresAt = getSessionExpiresAt(sess, this.ttlMs);
    this.ready
      .then(() => this.pool.query(
        `INSERT INTO ${this.tableName} (sid, sess, expire)
         VALUES ($1, $2, $3)
         ON CONFLICT (sid)
         DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [sid, sess, expiresAt]
      ))
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  touch(sid, sess, callback = () => {}) {
    const expiresAt = getSessionExpiresAt(sess, this.ttlMs);
    this.ready
      .then(() => this.pool.query(
        `UPDATE ${this.tableName} SET sess = $2, expire = $3 WHERE sid = $1`,
        [sid, sess, expiresAt]
      ))
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  destroy(sid, callback = () => {}) {
    this.ready
      .then(() => this.pool.query(`DELETE FROM ${this.tableName} WHERE sid = $1`, [sid]))
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  clear(callback = () => {}) {
    this.ready
      .then(() => this.pool.query(`DELETE FROM ${this.tableName}`))
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  length(callback) {
    this.ready
      .then(() => this.pool.query(`SELECT COUNT(*) AS total FROM ${this.tableName} WHERE expire > NOW()`))
      .then((result) => callback(null, Number(result.rows[0]?.total || 0)))
      .catch((err) => callback(err));
  }

  pruneExpiredSessions() {
    return this.ready.then(() => this.pool.query(`DELETE FROM ${this.tableName} WHERE expire <= NOW()`));
  }

  close() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (typeof this.pool.end === 'function') {
      return this.pool.end();
    }
    return Promise.resolve();
  }
}

function getSessionExpiresAt(sess, ttlMs) {
  const cookieExpires = sess?.cookie?.expires;
  const expiresAt = cookieExpires ? new Date(cookieExpires) : new Date(Date.now() + ttlMs);
  if (Number.isNaN(expiresAt.getTime())) {
    return new Date(Date.now() + ttlMs);
  }
  return expiresAt;
}

function quoteIdentifier(value) {
  const identifier = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error('Invalid PostgreSQL session table name.');
  }
  return `"${identifier}"`;
}

module.exports = {
  PostgresSessionStore,
  createPostgresSessionStore,
  getSessionExpiresAt
};
