# KVSK CCTV & IT Solution ERP System

Kinaadman ERP is a project-based ERP web application for managing company records, projects, service orders, invoices, receivables, procurement, payables, reports, users, and audit logs in one connected workflow.

## Feature Overview

### Dashboard And Workspace

- ERP command center with KPI cards, charts, counters, and project alerts
- Business entity/workspace context for operating-company-specific records
- Sidebar navigation aligned to ERP flow: Master Data, Sales Management, Service Operations, Projects, Procurement, Inventory, Financial Management, Reports, Admin, and Archives
- Notifications for project status, due dates, upcoming work, and completed records
- Dashboard company filtering and project status summaries

### Company And Business Entities

- Company Registry for customer/client master records
- Company number generation and company profile details
- Contact, address, TIN, industry, notes, and status tracking
- Company archive and restore support
- Company overview with linked projects, transactions, receivables, and service records
- Business Entity management for the ERP owner/operator companies
- Default business entity support and workspace theme/context handling
- Supplier/vendor profile creation from company or business entity records

### Project Management

- Project creation with generated project numbers
- Link projects to companies and business entities
- Project schedules with planned, actual, paused, cancelled, and completion fields
- Project manager, priority, budget, downpayment, quantity, unit cost, and team member details
- Project status tracking for planning, active, on-hold, completed, and cancelled states
- Project duplicate checks and company/project relationship validation
- Project archive and restore flow
- Project PDF attachment support
- Project task planning, progress tracking, dependencies, planned costs, and actual costs
- Project resource and cost tracking
- Gantt chart/planner workspace and import support

### Sales Management

- Sales invoice workspace for customer billing and project/service billing references
- Customer collections and customer balance monitoring
- Sales Management links operational service/project records into Accounts Receivable

### Service Operations

- Service Order creation with generated service order numbers
- Link service orders to business entities, vendors, companies, and projects
- Service type, service date, title, description, amount, status, and notes tracking
- Service Order PDF support
- Service document workspace for service order attachments
- Archive and restore service orders
- Service Orders can feed receivable and transaction workflows

### Financial Management - Accounts Receivable

- Invoice and receipt transaction records with generated document numbers
- Company, project, service order, client, address, TIN, phone, and business style fields
- Quantity, unit price, total amount, downpayment, check number, PO number, and PDF attachment support
- Transaction status tracking for paid, unpaid, and partial states
- Accounts Receivable records linked to transactions and projects
- AR invoice date, due date, payment terms, paid amount, balance, overdue, partial, and paid status handling
- Collection/payment recording for receivables
- Archive and restore for transactions and receivables
- Public user view for assigned/available transaction records

### Accounts Payable And Procurement

- Vendor directory with vendor number, contact details, TIN, address, status, and company/business entity linking
- Vendor active/inactive control
- Purchase Requisitions with generated PR numbers
- Requisition item lines with quantity, unit, estimated unit price, and total amount
- PR workflow: draft, submitted, approved, ordered, received, cancelled
- PR actions: submit for approval, approve, cancel, edit, delete, and convert to PO
- Purchase Orders with generated PO numbers
- PO vendor, company, project, requisition, delivery date, terms, prepared by, approved by, notes, and line items
- PO workflow: draft, pending, approved, received, cancelled
- PO actions: submit for approval, approve, cancel, edit, delete, receive goods, and generate AP bills
- Goods Receipts linked to approved purchase orders
- Goods Receipt status tracking for draft, received, and rejected
- AP Bills linked to vendors, projects, purchase orders, due dates, balances, statuses, and PDFs
- AP payment recording with date, amount, method, reference number, and notes
- Automatic payable status updates from payment balance
- Payment schedule generation from PO payment terms

### Accounting And HR Foundations

- Chart of accounts records
- Accounting period records
- Journal entries and journal lines
- Department records
- Employee records with department, job title, employment type, pay frequency, salary rate, contact details, hire date, and status
- Payroll periods, payroll runs, and payroll run lines

### Reports And Exports

- Reports module for projects, transactions, receivables, and financial summaries
- Dashboard charts and module counters
- Admin system logs with search and filtering
- System log export support
- Transaction export support
- AP/AR status summaries and operational views

### User Management And Security

- Login, logout, forgot password, and reset password flows
- Admin, staff, and user roles
- Role-based route and API protection
- Admin-only user management
- User create, edit, activate/deactivate, delete, and password reset actions
- CSRF protection for mutating requests
- Safer session cookie settings
- Login rate limiting and reset-password rate limiting
- Security response headers and disabled `x-powered-by`
- Default admin seeding disabled in production
- System logs with user, action, module, timestamp, and IP address

### Files, Backups, And Documentation

- PDF upload support for projects, transactions, service orders, and AP bills
- Local `uploads_pdf` runtime storage for the current Node deployment
- Backup script for database and uploaded PDFs
- Backup and recovery documentation
- Production readiness checklist
- Database/index audit documentation
- ERD, screenshots, documentation scripts, and PostgreSQL/Supabase migration plan

## Core ERP Workflows

```text
Business Entity -> Master Data -> Sales Management -> Service Operations -> Projects -> Accounts Receivable -> Collections
Project Requirement -> Procurement -> RFQ/Quotation -> Purchase Order -> Goods Receipt -> Inventory -> Accounts Payable -> Payments
Projects -> Tasks -> Costs -> Project Ledger -> Reports
Users -> Role Permissions -> Transactions -> System Logs -> Audit Review
```

## Main Modules

- `public/admin/index.html` - dashboard, projects, transactions, archived records, logs, and admin workspace
- `public/accounts-receivable/index.html` - Accounts Receivable screen reused by the Sales Management and Service Operations module modes
- `public/accounts-payable/index.html` - vendors, requisitions, purchase orders, goods receipts, bills, and payments
- `public/company/index.html` - company registry and company overview
- `public/business-entities/index.html` - operating company and workspace management
- `public/gantt-chart/index.html` - project timeline and planning workspace
- `public/reports/index.html` - reporting dashboard
- `public/user-management/index.html` - account and role management
- `public/user-index/index.html` - user-facing transaction view
- `public/login/index.html` - authentication entry point
- `public/reset-password/index.html` - password reset page

## Tech Stack

- Node.js
- Express
- PostgreSQL via `pg`
- Express sessions
- Multer for PDF/file uploads
- Nodemailer for password reset email support
- Vanilla HTML, CSS, and JavaScript frontend

## Scripts

```bash
npm start
npm test
npm run check
npm run predeploy
npm run backup
```

## Current Database

The current runtime database is PostgreSQL. Setup and migration notes are documented in `POSTGRES_MIGRATION.md`.

## Notes

- `.env` is excluded from version control.
- Uploaded PDFs and runtime files are kept outside the repo.
- Keep production secrets, database dumps, and uploaded client PDFs out of Git.
