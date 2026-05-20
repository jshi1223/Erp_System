const fs = require('fs');
const path = require('path');
const { createPostgresPool } = require('../lib/db/postgres');

const rootDir = path.resolve(__dirname, '..');
const migrationsDir = path.join(rootDir, 'migrations', 'postgres');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query('SELECT id FROM schema_migrations');
  return new Set(result.rows.map((row) => row.id));
}

async function applyMigration(client, filename) {
  const migrationPath = path.join(migrationsDir, filename);
  const sql = fs.readFileSync(migrationPath, 'utf8');

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    console.log(`Applied ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Missing migrations directory: ${migrationsDir}`);
  }

  const filenames = fs
    .readdirSync(migrationsDir)
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort();

  if (filenames.length === 0) {
    console.log('No PostgreSQL migrations found.');
    return;
  }

  const pool = createPostgresPool();
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const pending = filenames.filter((filename) => !applied.has(filename));

    if (pending.length === 0) {
      console.log('PostgreSQL database is already up to date.');
      return;
    }

    for (const filename of pending) {
      await applyMigration(client, filename);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
