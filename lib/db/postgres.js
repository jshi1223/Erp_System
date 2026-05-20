const { Pool } = require('pg');
const { loadEnv } = require('../load-env');

loadEnv();

function createPostgresPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for PostgreSQL migrations.');
  }

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
  });
}

module.exports = { createPostgresPool };
