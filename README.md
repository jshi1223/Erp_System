# KVSK CCTV & IT Solution ERP System

Project-based ERP web application for tracking companies, projects, transactions, receivables, payables, procurement, and service orders.

## Features

- Company Registry for master company records
- Project management with project-to-company linking
- Project transactions with invoice and payment tracking
- Service orders tied to projects, companies, and vendors
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
company_registry -> projects -> service_orders -> transactions -> accounts_receivable
company_registry -> purchase_requisitions -> purchase_orders -> goods_receipts -> stock_movements
projects -> purchase_orders -> vendors -> accounts_payable
```

## Main Modules

- `public/admin/index.html` - dashboard and project transaction interface
- `public/procurement/index.html` - procurement module
- `public/accounts-receivable/index.html` - receivables module
- `public/accounts-payable/index.html` - payables module
- `public/company/index.html` - company records
- `public/inventory/index.html` - inventory module

## Notes

- `.env` is excluded from version control.
- Uploaded PDFs and runtime files are kept outside the repo.
