# KVSK CCTV & IT Solution ERP System

Project-based ERP web application for tracking companies, projects, transactions, receivables, payables, and procurement.

## Features

- Company Registry for master company records
- Project management with project-to-company linking
- Project transactions with invoice and payment tracking
- Accounts Receivable dashboard and status tracking
- Accounts Payable linked to vendors and purchase orders
- Procurement module with:
  - Purchase Requisitions
  - Purchase Orders
  - Goods Receipts
- Vendor management
- Inventory module
- PDF attachment support for transactions and projects
- Dashboard analytics and charts
- Archive and restore flows for records
- User management and role-based access
- System logs and audit-friendly actions

## Core Flow

```text
company_registry -> projects -> transactions -> accounts_receivable
projects -> purchase_orders -> vendors -> accounts_payable
```

## Main Modules

- `public/admin-index.html` - dashboard and project transaction interface
- `public/procurement.html` - procurement module
- `public/accounts-receivable.html` - receivables module
- `public/accounts-payable.html` - payables module
- `public/company_registry.html` - company records
- `public/inventory.html` - inventory module

## Notes

- `.env` is excluded from version control.
- Uploaded PDFs and runtime files are kept outside the repo.
