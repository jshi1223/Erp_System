# Database And Index Audit

Date: May 1, 2026

## Critical Tables Checked

- `users`
- `projects`
- `transactions`
- `service_orders`
- `accounts_receivable`
- `accounts_payable`
- `purchase_orders`
- `po_line_items`
- `payments`
- `company_registry`
- `vendors`
- `journal_entries`
- `journal_lines`
- `purchase_requisitions`
- `goods_receipts`

## Current Findings

- Primary keys and major foreign keys are present.
- Unique keys exist for document numbers and business keys like `docno`, `so_number`, `po_number`, `invoice_number`, and `company_no`.
- Search-heavy name columns and date-based list columns have been indexed in the live database.

## Indexes Added In This Pass

- `vendors.vendor_name`
- `projects.project_name`
- `purchase_orders.po_date`
- `accounts_payable.bill_date, created_at`
- `accounts_receivable.invoice_date, created_at`
- `purchase_requisitions.created_at`
- `goods_receipts.received_date`
- `journal_entries.created_at`
- `employees.full_name`

## Result

- The live database now has the expected production-friendly list/search indexes.
- The remaining work is mainly operational: restore testing, staging verification, and deployment checks.
