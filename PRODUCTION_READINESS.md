# Production Readiness Checklist

## Implemented In This Pass

- Automated tests for critical security and ERP flow helpers
- Safer session cookie settings
- `x-powered-by` disabled
- Security response headers added
- Default API authentication gate added
- CSRF enforcement kept for mutating routes
- Default admin seed disabled in production
- Backup and recovery plan documented
- Database/index audit documented

## What To Verify Before Go-Live

- Run `npm test`
- Run the backup script once on staging
- Confirm the production `.env` values
- Restore one backup in a test environment
- Confirm the new indexes are present on the live database

## Notes

- The core ERP workflow is stable enough for production-style testing.
- Final go-live should still include a staging restore test and a smoke test of the major modules:
  - Login
  - Projects
  - Transactions
  - Accounts Receivable
  - Accounts Payable
  - Service Orders
  - Company Registry
