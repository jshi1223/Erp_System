DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_purchase_requisitions_project_required'
      AND conrelid = 'purchase_requisitions'::regclass
  ) THEN
    ALTER TABLE purchase_requisitions
      ADD CONSTRAINT chk_purchase_requisitions_project_required
      CHECK (project_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
