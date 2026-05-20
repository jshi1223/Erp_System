ALTER TABLE purchase_requisitions DROP CONSTRAINT IF EXISTS purchase_requisitions_company_id_fkey;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_accounts_receivable_transaction_id
  ON accounts_receivable (transaction_id)
  WHERE transaction_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_company_registry_business_entity_id') THEN
    ALTER TABLE company_registry
      ADD CONSTRAINT fk_company_registry_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vendors_company_id') THEN
    ALTER TABLE vendors
      ADD CONSTRAINT fk_vendors_company_id
      FOREIGN KEY (company_id) REFERENCES company_registry(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vendors_business_entity_id') THEN
    ALTER TABLE vendors
      ADD CONSTRAINT fk_vendors_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_projects_business_entity_id') THEN
    ALTER TABLE projects
      ADD CONSTRAINT fk_projects_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_service_orders_business_entity_id') THEN
    ALTER TABLE service_orders
      ADD CONSTRAINT fk_service_orders_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_service_orders_company_id') THEN
    ALTER TABLE service_orders
      ADD CONSTRAINT fk_service_orders_company_id
      FOREIGN KEY (company_id) REFERENCES company_registry(id)
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_service_orders_project_id') THEN
    ALTER TABLE service_orders
      ADD CONSTRAINT fk_service_orders_project_id
      FOREIGN KEY (project_id) REFERENCES projects(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_service_orders_vendor_id') THEN
    ALTER TABLE service_orders
      ADD CONSTRAINT fk_service_orders_vendor_id
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_business_entity_id') THEN
    ALTER TABLE transactions
      ADD CONSTRAINT fk_transactions_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_company_id') THEN
    ALTER TABLE transactions
      ADD CONSTRAINT fk_transactions_company_id
      FOREIGN KEY (company_id) REFERENCES company_registry(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_purchase_requisitions_business_entity_id') THEN
    ALTER TABLE purchase_requisitions
      ADD CONSTRAINT fk_purchase_requisitions_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_purchase_orders_business_entity_id') THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT fk_purchase_orders_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_purchase_orders_project_id') THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT fk_purchase_orders_project_id
      FOREIGN KEY (project_id) REFERENCES projects(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_accounts_payable_business_entity_id') THEN
    ALTER TABLE accounts_payable
      ADD CONSTRAINT fk_accounts_payable_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_accounts_receivable_business_entity_id') THEN
    ALTER TABLE accounts_receivable
      ADD CONSTRAINT fk_accounts_receivable_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_approved_by') THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_approved_by
      FOREIGN KEY (approved_by) REFERENCES users(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_payments_single_ledger_link') THEN
    ALTER TABLE payments
      ADD CONSTRAINT chk_payments_single_ledger_link
      CHECK (
        (payment_type = 'ap' AND ap_id IS NOT NULL AND ar_id IS NULL)
        OR (payment_type = 'ar' AND ar_id IS NOT NULL AND ap_id IS NULL)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_journal_lines_single_side_amount') THEN
    ALTER TABLE journal_lines
      ADD CONSTRAINT chk_journal_lines_single_side_amount
      CHECK (
        debit >= 0
        AND credit >= 0
        AND (
          (debit > 0 AND credit = 0)
          OR (credit > 0 AND debit = 0)
        )
      );
  END IF;
END $$;
