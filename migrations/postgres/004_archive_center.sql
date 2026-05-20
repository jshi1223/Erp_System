ALTER TABLE transactions ADD COLUMN IF NOT EXISTS archived_at timestamp NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at timestamp NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_archive_center
  ON transactions (archived, archived_at, id);

CREATE INDEX IF NOT EXISTS idx_projects_archive_center
  ON projects (is_archived, archived_at, id);

CREATE INDEX IF NOT EXISTS idx_company_registry_archive_center
  ON company_registry (archived, archived_at, id);

CREATE INDEX IF NOT EXISTS idx_accounts_receivable_archive_center
  ON accounts_receivable (archived, archived_at, id);

CREATE INDEX IF NOT EXISTS idx_service_orders_archive_center
  ON service_orders (is_archived, archived_at, id);
