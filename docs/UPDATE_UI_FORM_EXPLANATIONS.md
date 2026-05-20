# UPDATE UI - Form Explanations

Source reference: `UPDATE UI.docx` listed the target screens as Login Page, Register, Dashboard, Projects, Project Overview, Procurement, Accounts Payable, Accounts Receivable, User Management, Business Entities, Archive Center, and System Logs.

This document explains the purpose of each form or screen, the important fields, and what happens after saving or using the form.

## Picture-by-Picture Explanations

### Picture 1 - KVSK Login Page

This picture shows the login screen for the KVSK workspace. The user enters a username and password before accessing the ERP. The page also includes Forgot Password and Create Account options.

Reason:
This screen protects the system because only registered and approved users can enter the ERP. It also separates access based on the selected business workspace.

### Picture 2 - KITSI Login Page

This picture shows the login screen for the KITSI workspace. It has the same login process as KVSK but uses the KITSI branding and workspace context.

Reason:
The system supports more than one operating business. By showing the KITSI workspace separately, users can clearly know which company records they are about to access.

### Picture 3 - KVSK Register Page

This picture shows the account registration form for the KVSK workspace. The user provides full name, username, email address, and password.

Reason:
Registration is used for access requests only. The account remains pending until an admin approves it in User Management, which prevents unauthorized users from entering the system.

### Picture 4 - KITSI Register Page

This picture shows the account registration form for the KITSI workspace. It works like the KVSK registration page but is tied to the KITSI branding and context.

Reason:
This keeps account requests organized by business workspace. It helps admins identify which business entity the user is trying to access.

### Picture 5 - KVSK Dashboard

This picture shows the main dashboard for the KVSK workspace. It displays summary cards for Company Registry, Projects, Procurement, Accounts Payable, Accounts Receivable, and Reports.

Reason:
The dashboard is the starting point after login. It gives a quick overview of important ERP records and lets the user open major modules quickly.

### Picture 6 - KITSI Dashboard

This picture shows the same dashboard layout under the KITSI workspace. The cards and modules are the same, but the records are filtered by the selected business context.

Reason:
This proves that the ERP can manage multiple company workspaces while keeping the data separated.

### Picture 7 - KVSK Projects Page

This picture shows the Projects module for KVSK. It lists project records with project number, title, company, manager, status, priority, dates, amount, and actions.

Reason:
The Projects page is used to monitor project operations. It connects project records to transactions, service orders, documents, AP, AR, and reports.

### Picture 8 - KITSI Projects Page

This picture shows the Projects module under the KITSI workspace. It has the same functions as KVSK Projects but displays the KITSI-specific project records.

Reason:
This keeps projects organized per business entity so one company workspace does not mix with another company's records.

### Picture 9 - Project Overview

This picture shows the Project Overview page. It summarizes one project's financial and operational records, including AR total, AP total, collected payments, service orders, documents, and project status.

Reason:
Project Overview helps users understand the full condition of a project in one screen. It is useful for checking profitability, balances, payments, and linked activities.

### Picture 10 - KITSI Procurement Management

This picture shows the Procurement module for the KITSI workspace. It includes vendors, purchase requisitions, RFQ, quotations, purchase orders, goods receipts, and documents.

Reason:
Procurement manages the buying process before it becomes a payable bill. It makes purchasing traceable from request to approval to receiving.

### Picture 11 - KVSK Procurement Management

This picture shows the Procurement module for the KVSK workspace. It uses the same workflow as KITSI but is filtered to KVSK records.

Reason:
This allows each business workspace to manage suppliers, purchase requests, purchase orders, and receiving separately.

### Picture 12 - KITSI Accounts Payable Management

This picture shows the Accounts Payable module for KITSI. It tracks open bills, total payable, overdue amount, paid bills, and payment records.

Reason:
Accounts Payable helps the business monitor money owed to vendors and suppliers. It also supports due-date tracking and payment history.

### Picture 13 - KVSK Accounts Payable Management

This picture shows the Accounts Payable module for KVSK. It has bills, vendor balances, AP aging, payments, and disbursement monitoring.

Reason:
This helps KVSK manage supplier obligations separately from KITSI, avoiding mixed payables and wrong payment reporting.

### Picture 14 - KITSI Accounts Receivable Management

This picture shows the Accounts Receivable module for KITSI. It includes service orders, invoices, collections, customer balances, AR aging, and documents.

Reason:
Accounts Receivable tracks money customers owe to the business. It helps monitor unpaid invoices, partial payments, paid invoices, and collection performance.

### Picture 15 - KVSK Accounts Receivable Management

This picture shows the Accounts Receivable module for KVSK. It tracks customer invoices, outstanding balances, overdue receivables, collections, and related service orders.

Reason:
This keeps customer billing and collection records organized under the correct business workspace.

### Picture 16 - User Management

This picture shows the User Management page. It includes account approval requests, active users, roles, status filters, and user actions.

Reason:
User Management controls who can access the ERP. Admins can approve new users, assign roles, activate or deactivate accounts, and protect sensitive modules.

### Picture 17 - Business Entities

This picture shows the Business Entities page. It lists business titles/workspaces such as KVSK and KITSI, including code, contact details, status, default setting, and actions.

Reason:
Business Entities are needed because the ERP is used by more than one operating business. They separate records by company/workspace, so projects, AP, AR, reports, vendors, service orders, and documents are not mixed together.

Why Business Entities are important:
- They separate KVSK records from KITSI records.
- They make reports accurate per business.
- They prevent users from accidentally creating transactions under the wrong company.
- They allow one ERP system to support multiple business names.
- They make dashboards, projects, AP, AR, procurement, and reports easier to filter.
- They support a default workspace so users have a clear starting business context.

Example:
If KVSK and KITSI both use the same ERP, each business can have its own projects, suppliers, invoices, bills, and reports. Without Business Entities, all records would be mixed and financial reports could become inaccurate.

### Picture 18 - Archive Center

This picture shows the Archive Center. It displays archived projects, transactions, companies, AR records, and service orders.

Reason:
Archive Center keeps inactive or removed records out of the active tables without immediately deleting them. Admins can restore records when needed or review archived data for tracking.

### Picture 19 - System Logs

This picture shows the System Logs page. It displays timestamp, module, user, action, and details for system activities.

Reason:
System Logs provide an audit trail. Admins can check who logged in, created records, updated records, archived data, restored records, or changed user access.

## 1. Login Page

The Login Page is the secure entry point of the ERP system. Users enter their username and password to access the correct workspace and modules based on their assigned role.

Important fields and controls:
- Username - identifies the registered ERP account.
- Password - verifies the account credentials.
- Show password button - helps users check password input before signing in.
- Forgot Password - opens account recovery through email reset.
- Create Account - opens the registration request form.

Process:
1. The user enters username and password.
2. The system validates the account.
3. If valid, the user is redirected to the dashboard or permitted workspace.
4. If invalid, the page shows an error message and blocks access.

Purpose:
The form protects ERP records from unauthorized access and ensures that only approved users can open modules such as Projects, AP, AR, Reports, and Admin tools.

## 2. Register / Create Account

The Register form is used when a new user requests access to the ERP system. The account is not automatically activated; it remains pending until an administrator approves it in User Management.

Important fields:
- Full Name - complete name of the requesting user.
- Username - login name to be used after approval.
- Email Address - contact email and possible password recovery email.
- Password - initial password for the account.

Process:
1. The user fills out the registration details.
2. The system saves the request as a pending user account.
3. An admin reviews the request in User Management.
4. Once approved, the user can log in according to the assigned role.

Purpose:
This form supports controlled onboarding. It prevents unknown users from immediately accessing company and financial records.

## 3. Dashboard

The Dashboard is the command center of the ERP. It gives a quick summary of major records and provides shortcuts to the main modules.

Main areas:
- Company Registry card - shows registered client/company records.
- Projects card - shows project count and opens project operations.
- Procurement card - opens vendor, requisition, PO, and receiving workflows.
- Accounts Payable card - shows payable amount and opens AP bills.
- Accounts Receivable card - shows receivable amount and opens AR records.
- Reports card - opens analytics and summaries.
- Notifications - shows project alerts such as due soon, pending, expired, or completed records.

Purpose:
The Dashboard helps users monitor the overall status of operations without opening each module one by one. It also acts as the navigation hub for daily ERP work.

## 4. Company Registry Form

The Company Registry form is used to register clients, customers, or related companies that will be connected to projects, service orders, transactions, purchase orders, vendors, and receivables.

Important fields:
- Company No. - system-generated company number.
- Branch Code - optional branch identifier.
- Company Name - official company or client name.
- Address - complete company address.
- Contact Person - primary contact for coordination.
- Phone - company or contact phone number.
- Email - contact email address.
- TIN - tax identification number.
- Status - active or inactive.
- Notes - optional remarks.

Related records shown after saving:
- Projects
- Service Orders
- Transactions
- Purchase Orders
- Vendors
- Receivables

Purpose:
This form creates the master company record. Other modules reuse this information so project, billing, payable, and receivable records stay connected to the correct company.

## 5. Projects Form

The Projects form is used to create or update project records. It keeps the project as the main operational record and connects it to the client company, schedule, budget, team, and related documents.

Form sections:
- Details - project title, project number, company, manager, status, priority, and scope.
- Dates - planned start, planned end, actual start, actual end, and status reason.
- Financials - contract amount, downpayment, balance, payment status, check number, and customer PO reference.
- Team - project members, roles, and contact numbers.

Important fields:
- Project Title - name or description of the project.
- Project No. - generated project identifier.
- Company - client or company connected to the project.
- Project Manager - accountable person.
- Status - planning, active, on hold, completed, or cancelled.
- Priority - low, medium, high, or urgent.
- Start Date and End Date - planned schedule.
- Contract Amount and Downpayment - financial basis for the project.

Process:
1. The user creates a project and links it to a company.
2. The system stores schedule, financial, and team information.
3. The project can later connect to service orders, AR, AP, payments, documents, and reports.

Purpose:
This form is the foundation of project-based tracking. It makes every transaction, cost, payable, receivable, and service activity traceable to a specific project.

## 6. Project Overview

Project Overview is the consolidated view of one project or the project workspace. It summarizes linked operational and financial records.

Main tabs and areas:
- Overview - high-level project summary.
- AR - receivables and invoices connected to the project.
- AP - bills and supplier costs connected to the project.
- Payments - payment records from AP and AR.
- Service Orders - service activities tied to the project.
- Documents - attached PDF files and related documents.

Main metrics:
- AR Total - total receivables or billings.
- Collected - payments received from customers.
- AP Total - supplier bills and project costs.
- Net Position - difference between receivables collected/expected and payable costs.

Purpose:
Project Overview helps users see the full financial and operational condition of a project in one place. It is useful for checking profitability, outstanding balances, and pending actions.

## 7. Service Order Form

The Service Order form records services performed for a company or project, such as installation, maintenance, repair, inspection, upgrade, or support.

Important fields:
- SO Number - generated service order number.
- Date - service order date.
- Project - optional linked project.
- Service Title - required service name or description.
- Type - service category.
- Company - client/company receiving the service.
- Vendor - vendor or supplier assigned to the service.
- Amount - service amount.
- Notes - optional service remarks.
- Status - issued, accepted, in progress, completed, or cancelled.

Process:
1. The user creates a service order and links it to a project/company/vendor.
2. The system saves the service activity.
3. Saving a service order can create a linked transaction automatically.

Purpose:
This form connects actual service work to project, billing, and receivable workflows.

## 8. Transaction Form

The Transaction form records invoices or receipts. It can be created manually or linked to a project or service order.

Important fields:
- Transaction No. - generated transaction number.
- Project - optional project link.
- Customer / Charged To - required client name.
- Linked Service Order - optional service order reference.
- Description - item or service description.
- Check No. - optional payment reference.
- Customer PO Ref. - customer purchase order reference.
- Qty - quantity.
- Unit Price - price per unit.
- Transaction Total - computed total amount.
- Transaction Status - paid, unpaid, or partial.
- Balance - computed remaining balance.
- Date - system date.
- PDF attachment - supporting document for the transaction.

Purpose:
This form creates official billing or receipt records. It supports AR tracking by keeping customer, project, amount, payment status, and document attachment in one record.

## 9. Procurement Module

Procurement handles the purchasing workflow before records become payable bills. It covers vendor records, purchase requisitions, RFQ/quotations, purchase orders, goods receipts, and attached documents.

Purpose:
Procurement controls the buying process from request to supplier selection to purchase order and receiving. It keeps purchases traceable to projects and companies.

### 9.1 Vendor Form

The Vendor form registers suppliers used in procurement and AP.

Important fields:
- Vendor No. - generated vendor number.
- Vendor Name - supplier name.
- Contact Person - main supplier contact.
- Email - supplier email.
- Phone - supplier phone number.
- TIN - tax identification number.
- Address - supplier address.

Purpose:
This form creates the supplier master record used by quotations, purchase orders, goods receipts, bills, and payments.

### 9.2 Purchase Requisition Form

The Purchase Requisition form records a request to buy materials, equipment, or services needed for a project.

Important fields:
- PR No. - generated requisition number.
- Company - auto-filled from the selected project when available.
- Project - required project link for traceability.
- Request Date - date of request.
- Department - requesting department.
- Requested By - requesting person.
- Needed By - target need date.
- Status - draft, submitted, approved, ordered, received, or cancelled.
- Requested Items - line items with quantity, unit, estimated price, and total.
- Notes - internal notes.

Purpose:
This form starts the procurement approval process and ensures requested items are tied to a project.

### 9.3 Quotation / Evaluation Form

The Quotation form records vendor offers for an approved purchase requisition.

Important fields:
- Quotation No. - generated quotation number.
- Approved PR - approved requisition being quoted.
- Vendor - supplier submitting the offer.
- Quote Date - date of quotation.
- Quoted Total - supplier quoted amount.
- Delivery Days - estimated delivery duration.
- Score - evaluation score.
- Status - draft, submitted, selected, or rejected.
- Payment Terms - supplier payment terms.
- Warranty / Terms - warranty or other conditions.
- Remarks - evaluation notes.

Purpose:
This form compares supplier offers and supports selecting the best vendor before creating a purchase order.

### 9.4 Purchase Order Form

The Purchase Order form records the approved order issued to a supplier.

Important fields:
- PO No. - generated purchase order number.
- Project - optional project cost link.
- Company - company context, usually synced from project or requisition.
- Requisition - optional source PR.
- Vendor - required supplier.
- PO Date - required order date.
- Delivery Date - expected delivery.
- Payment Terms - payment schedule or terms.
- Prepared By and Approved By - responsible personnel.
- Status - draft, pending, approved, received, or cancelled.
- Descriptions - purchase order line items.
- Purchase Order Total - computed total.
- Notes - vendor instructions or remarks.

Purpose:
This form formalizes the purchase and becomes the basis for receiving goods and generating AP bills.

### 9.5 Goods Receipt Form

The Goods Receipt form records items or services received from an approved purchase order.

Important fields:
- GRN No. - generated goods receipt number.
- PO No. - required linked purchase order.
- Vendor, Company, Project, and PO Total - readonly context from the PO.
- Received Date - date goods/services were received.
- Received By - receiving person.
- Status - received, draft, or rejected.
- Notes - receiving remarks.

Purpose:
This form confirms delivery or receipt. It supports the transition from PO to payable bill.

### 9.6 Attached PDFs Form

The Attached PDFs form stores supporting procurement documents.

Important fields:
- Document Type - signed PO, supplier quotation, delivery receipt, approval proof, or other attachment.
- PDF File - uploaded supporting PDF.

Purpose:
This form keeps procurement evidence connected to the correct record, making audit and review easier.

## 10. Accounts Payable

Accounts Payable tracks supplier obligations, bills, balances, aging, payments, and disbursements.

Main tabs:
- Vendors - supplier directory.
- Purchase Requisitions - purchase requests.
- RFQ - request for quotation workspace.
- Quotations & Evaluation - vendor offers and evaluation.
- Purchase Orders - approved purchase orders.
- Goods Receipts - received goods/services.
- Bills - payable register.
- Vendor Balances - balances per supplier.
- AP Aging - due and overdue payables.
- Payments - payment ledger.
- Disbursements - outgoing cash/payment summary.

Purpose:
AP ensures the company can monitor what it owes to vendors, what has already been paid, and which bills are overdue.

### 10.1 AP Bill Form

The AP Bill form records a supplier bill payable by the company.

Important fields:
- Vendor - required supplier.
- Purchase Order - optional linked PO.
- Bill Number - generated bill number.
- Project - optional linked project.
- Bill Date - required bill date.
- Due Date - payment due date.
- Total Amount - required bill amount.
- PDF attachment - bill or invoice document.
- Notes - optional bill remarks.

Purpose:
This form creates a payable record. It feeds AP balances, AP aging, vendor balances, and payment tracking.

### 10.2 AP Payment Form

The AP Payment form records money paid to a supplier bill.

Important fields:
- Bill - required payable record.
- Payment Date - payment date.
- Amount Paid - amount released.
- Payment Method - cash, check, bank transfer, or credit card.
- Reference Number - check number or bank reference.
- Notes - payment remarks.

Purpose:
This form reduces the payable balance and updates the bill status based on the remaining amount.

## 11. Accounts Receivable

Accounts Receivable tracks customer invoices, service orders, collections, customer balances, AR aging, and documents.

Main tabs:
- Service Orders - service activity records.
- Invoices - receivable records.
- Collections - customer payments.
- Customer Balances - balances by customer.
- AR Aging - current and overdue receivables.
- Documents - attached AR-related files.

Purpose:
AR helps the company monitor what customers owe, what has been collected, and which invoices need follow-up.

### 11.1 AR Transaction Form

The AR Transaction form records invoice or receipt transactions within the AR module.

Important fields:
- Transaction No. - generated transaction number.
- Type - invoice or receipt.
- Service Order - optional linked service order.
- Customer / Company - required customer name.
- Date - transaction date.
- Description - transaction details.
- Amount - transaction amount.
- Paid / Downpayment - amount already paid.
- Status - unpaid, partial, or paid.
- Check No. - check reference.
- Customer PO Ref. - customer purchase order reference.

Purpose:
This form records billing and receipt activity and can be used as the source for receivable records.

### 11.2 Receivable Form

The Receivable form creates the official customer receivable based on a linked transaction.

Important fields:
- Linked Transaction - required source transaction.
- Customer / Company - customer name.
- Invoice Number - invoice identifier.
- Invoice Date - invoice date.
- Payment Terms - due on receipt, Net 7, Net 15, Net 30, Net 45, Net 60, or custom.
- Due Date - computed or manually set due date.
- Total Amount - receivable amount.
- Status - draft, sent, partial, paid, or overdue.
- Notes - optional remarks.

Purpose:
This form controls invoice due dates, balances, and AR aging status.

### 11.3 Collection / AR Payment Form

The Collection form records payments received from customers.

Important fields:
- Receivable - invoice or receivable being paid.
- Payment Date - collection date.
- Amount - amount collected.
- Payment Method - cash, check, bank transfer, or credit card.
- Reference Number - OR or payment reference.
- Notes - optional payment remarks.

Purpose:
This form reduces the customer receivable balance and updates collection totals and invoice status.

## 12. User Management

User Management is the administrator workspace for approving registration requests and maintaining user accounts.

Main tabs:
- Approving - pending registration requests.
- Users - active, inactive, or rejected system users.

Important fields and controls:
- Search - finds users by name, username, email, or role.
- Role Filter - filters users by super admin, admin, staff, or user.
- Status Filter - filters by active, inactive, or rejected.
- Edit User modal - updates full name, username, email, role, and status.
- Current Admin Password - required for sensitive role changes.

Purpose:
This form protects the system by controlling who can access the ERP and what level of permission they receive.

## 13. Business Entities

The Business Entities form manages the operating company or workspace context used to separate ERP records.

Important fields:
- Entity Code - optional short code such as KVSK.
- Business Title - registered business title.
- Address - business address.
- Contact Person - primary contact.
- Phone - contact number.
- Email - contact email.
- TIN - tax identification number.
- Status - active or inactive.
- Set as default - marks the default business entity.

Purpose:
Business Entities keep records separated by operating company. Projects, AP, AR, reports, and documents can be scoped to the correct business title.

Why this module is needed:
- The ERP can be used by multiple business names, such as KVSK and KITSI.
- Each business may have separate projects, clients, vendors, invoices, bills, and reports.
- Business Entities prevent mixed records between different operating companies.
- They make dashboard totals, AP balances, AR balances, and reports more accurate.
- They help users choose the correct workspace before creating records.
- They allow the system to set a default business entity for faster daily use.

In simple terms:
Business Entities act like the company/workspace selector of the ERP. They make sure that when the user creates a project, bill, invoice, purchase order, or report, the record belongs to the correct business.

## 14. Archive Center

Archive Center stores records that were removed from active views but not permanently deleted.

Main categories:
- Projects
- Transactions
- Companies
- AR
- Service Orders

Important controls:
- Search - finds archived records.
- Refresh - reloads archive counts and records.
- Restore - returns a record to active use.
- Permanent Delete - removes a record permanently when allowed.

Purpose:
Archive Center supports record cleanup without immediate data loss. It also gives admins a controlled place to restore accidentally archived records.

## 15. System Logs

System Logs show the audit trail of important actions in the ERP.

Important fields and controls:
- Timestamp - date and time of the action.
- Module - area where the action happened.
- User - account that performed the action.
- Action - event type such as login, logout, create transaction, update transaction, archive transaction, restore transaction, create user, toggle user status, delete user, or hard delete.
- Details - description of the activity.
- Search - finds logs by user, action, or details.
- Action Filter - narrows logs by action type.
- Export Excel / Export PDF - downloads log reports.

Purpose:
System Logs provide accountability and audit support. Admins can trace who changed records, when changes happened, and what module was affected.

## 16. Reports

The Reports screen summarizes ERP performance across projects, collections, invoices, vendors, and clients.

Main sections:
- Collections Overview - compares AR and collected amounts over 6 months or 1 year.
- Invoice Status - shows paid, partial, and unpaid invoice counts.
- Project Profitability - compares contract, AR, AP cost, gross profit, and margin.
- Cash Flow Snapshot - shows open AR, open AP, and net cash exposure.
- Vendor Spend - summarizes bill and spend totals by vendor.
- Client Revenue - summarizes invoice and revenue totals by client.

Purpose:
Reports convert ERP records into management summaries. They help users review collection performance, project profitability, vendor cost, client revenue, and cash exposure.

## 17. User Transaction Status Page

The User Transaction Status page is the user-facing view for transaction records.

Main tabs:
- All - all visible transaction records.
- Receipts - receipt records only.
- Invoices - invoice records only.

Purpose:
This page allows non-admin or limited-access users to review transaction status without opening the full admin workspace.
