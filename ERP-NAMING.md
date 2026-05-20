# ERP Naming Standard

Use these names consistently in the UI, DBML, and future screens.

## Module Names

- `ERP Command Center` - dashboard home
- `Company Master` - company registry
- `Project Operations` - project entry and tracking
- `Project Ledger` - project transactions and documents
- `AP Ledger` - accounts payable
- `AR Ledger` - accounts receivable
- `Archives` - archived records

## Database Mapping

- `company_registry` -> `Company Master`
- `projects` -> `Project Operations`
- `transactions` -> `Project Ledger`
- `vendors` -> `AP Ledger`
- `purchase_orders` -> `AP Ledger`
- `accounts_payable` -> `AP Ledger`
- `accounts_receivable` -> `AR Ledger`
- `system_logs` -> `System Logs`
- `users` -> `User Management`

## Navigation Labels

- `Back` means return to the previous screen if there is a history entry.
- `Dashboard` means go to the dashboard home when there is no previous page.
- `Back to Dashboard` is only used inside dashboard panels, not on module pages.

## UI Rule

- If the page is a module page, the header should stay module-specific.
- If the page is a summary or home page, use dashboard-first naming.
- Keep the same label for the same concept everywhere. Do not mix `Company Registry` and `Company Master` in the same UI.
