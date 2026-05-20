# Sprint Documentation

Project: KVSK CCTV & IT Solution ERP System

Duration: 5 Weeks

## Project Overview

This ERP system was developed to manage company registry, project operations, procurement, service orders, accounts payable, accounts receivable, user accounts, reports, and system logs in one centralized web application.

The goal of the sprint was to build a clean, organized, and user-friendly system with:

- separate modules for each business process
- shared UI components for consistency
- direct connection between UI and database
- responsive design for admin, staff, and user views
- cleaner navigation and easier maintenance

## Week 1: Planning and System Foundation

### What was done

- Defined the main scope of the system and the modules to be included.
- Organized the naming standard for pages, tables, and navigation labels.
- Prepared the base database structure using DBML and SQL mapping.
- Set up the initial layout pattern for header, sidebar, toolbar, tables, and modals.
- Established the first version of shared styles and shared script helpers.

### Explanation

This week focused on the foundation of the whole project. The main purpose was to make sure every module would follow one structure, one naming style, and one design direction. This reduced confusion later when more features were added.

### Output

- Initial ERP layout
- Shared naming rules
- Base database plan
- Reusable UI structure

## Week 2: Core Module Development

### What was done

- Built the main business modules:
  - Company Registry
  - Project Operations
  - Procurement
  - Accounts Payable
  - Accounts Receivable
  - User Management
  - Reports
- Connected forms and tables to backend API routes.
- Added search, filters, summary cards, and modal forms.
- Implemented role-based access for admin, staff, and user areas.
- Added dashboard counters and record views for easier monitoring.

### Explanation

This week focused on the actual working features of the system. The UI was connected to the backend so data could be saved, updated, loaded, and displayed in tables. This was the phase where the system started becoming usable for real operations.

### Output

- Working CRUD flows
- Table-based record views
- Form modals for data entry
- Admin and module pages connected to the database

## Week 3: Refactoring and Bug Fixes

### What was done

- Split the old shared core logic into separate module scripts.
- Organized shared logic into reusable files such as core helpers and shared styles.
- Fixed loading issues, save issues, and table refresh problems.
- Corrected button labels, back navigation behavior, and toolbar alignment.
- Improved search bar width, validation messages, and empty-state behavior.
- Cleaned up broken or confusing file references and cached assets.

### Explanation

This week was focused on making the system stable and easier to maintain. Instead of keeping everything in one large file, the code was separated into smaller files per module. This made the project cleaner, easier to debug, and easier to expand in the future.

### Output

- Better file organization
- Fixed record saving and table updating
- Improved navigation behavior
- Cleaner and more maintainable code structure

## Week 4: UI Polish and Final Integration

### What was done

- Updated the overall theme to black, dark red, and white.
- Refined the header, sidebar, cards, tables, and toolbar layout.
- Standardized stat cards and summary cards across the system.
- Added and aligned the Vendors tab inside Procurement.
- Improved procurement vendor selection to match the actual vendors table.
- Adjusted page spacing, search field sizes, and responsive behavior.
- Applied final consistency updates across admin, staff, and user pages.

### Explanation

This week focused on visual polish and final integration. The system was made more user-friendly and visually consistent so it feels like one complete platform instead of separate pages stitched together. The Procurement module was also improved by moving vendor management into its own tab, which matches how the workflow should be organized.

### Output

- Finalized dark-themed UI
- More consistent card and table design
- Procurement vendor tab added
- Better overall user experience
- Nearly completed system presentation for deployment or demo

## Week 5: Service Order Feature Refinement (April 27, 2025 - May 1, 2025)

Sprint Period: April 27, 2025 - May 1, 2025

All updates under this week keep the same sprint period label for consistency.

### What was done

- Designed the Service Order module using the same visual pattern as Project Operations.
- Added table actions for Create, Add, Edit, and Archive to match the rest of the ERP system.
- Displayed the main table fields: auto-generated SO No., Date, Vendor, Company, Service Title, and Amount.
- Connected the Service Order form to the related Project, Company, and Vendor records.
- Refined modal validation and field relationships for clearer data entry.
- Connected the ERP traceability flow so Service Order, Project, Transaction, and Accounts Receivable stay linked.

### Explanation

This sprint focused on the Service Order module and how it fits into the ERP workflow. The UI was intentionally patterned after Project Operations so the module feels consistent across the system. For better traceability, the relationship flow is organized as:

- Service Order -> Project
- Project -> Service Order-linked Transaction
- Transaction -> Accounts Receivable
- Project remains the parent context for company and reporting

This makes it easier to trace where a service order came from, how it is billed, and how it is collected. Transactions now auto-link to the selected project service order, and Accounts Receivable inherits the project and service order reference from the transaction.

### Output

- Consistent Service Order UI
- Clear table actions and field layout
- Stronger module relationships
- Better ERP traceability

## Final Result

After five weeks, the project became a working ERP system with clear module separation, consistent UI, stronger navigation, and better data flow between the frontend and backend.

The system now supports:

- project management
- company registry
- procurement and vendors
- accounts payable and receivable
- user and role control
- report viewing
- service order relationship management
- reusable shared components

## Short Summary

Week 1: Planning and foundation  
Week 2: Core module development  
Week 3: Refactoring and bug fixing  
Week 4: UI polish and final integration  
Week 5 (April 27, 2025 - May 1, 2025): Service order feature refinement and relationship mapping
