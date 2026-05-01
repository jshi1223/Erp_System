# Backup And Recovery Plan

This project should keep two backup layers:

1. Database backups
2. File backups for uploaded PDFs and related attachments

## Backup Schedule

- Daily: full MySQL dump of the `kinaadman` database
- Daily: archive the `uploads_pdf` folder
- Weekly: keep one offsite copy
- Monthly: verify a restore into a staging copy

## Backup Script

Use `scripts/backup-production.ps1` on the Windows/XAMPP host.

What it saves:

- Database SQL dump
- `uploads_pdf` archive

## Recovery Steps

1. Stop the Node server.
2. Restore the database from the latest `.sql` dump.
3. Restore the latest `uploads_pdf` archive.
4. Verify `.env` production values.
5. Start the server and confirm login, projects, transactions, AR/AP, and service orders.

## Recovery Checkpoints

- Login works for admin and staff
- Project list loads
- Transaction table loads
- AR and AP statuses match payments
- Service Orders still link to project/company/vendor
- Uploaded files open correctly

## Notes

- Keep at least 7 daily backups.
- Keep 4 weekly backups.
- Keep 12 monthly backups.
- Test a restore before going live after major changes.
