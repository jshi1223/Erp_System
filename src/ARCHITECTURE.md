# Backend modular architecture (target)

Goal: split the 21k-line `server.js` into domain **modules** with **sub-modules**, mirroring
the ERP's own module/sub-module layout. Done **incrementally** — `server.js` keeps working
the whole time and only becomes a thin entry that mounts module routers. **Nothing is dropped**
(see the checklist below).

```
src/
├── modules/
│   ├── procurement/        requisitions · rfq · quotations · purchase-orders · goods-receipts · requests
│   ├── inventory/          products · warehouses · stock · movements · serial-units · requests
│   ├── sales/              inquiry · quotation · order · delivery-receipt · requests
│   ├── projects/           projects · records · ledger
│   ├── accounts-payable/   bills · payments · disbursements · vendor-balances · aging
│   ├── accounts-receivable/invoices · receipts · collections · aging
│   ├── approval-center/
│   ├── reports/
│   ├── master-data/        company-registry · vendors
│   ├── users/              user management + auth routes
│   ├── business-entities/
│   └── notifications/
├── shared/                 format, validation, pdf, email, document-no, misc helpers
├── middleware/             auth (protectAdmin/protectSuperAdmin/CSRF), upload (multer)
└── database/               connection (db + queryAsync), migrations
```

## Module pattern

Each **module** has an `index.js` that mounts its **sub-module** routers:

```js
// src/modules/procurement/index.js
const router = require('express').Router();
router.use(require('./requisitions/requisitions.routes'));
router.use(require('./rfq/rfq.routes'));
// …
module.exports = router;
```

Each **sub-module**: `<name>.routes.js` (Express routes) + `<name>.service.js` (DB/business
logic) + optional `<name>.pdf.js`. Routes import from `../../../database`, `../../../middleware`,
`../../../shared`.

`server.js` (eventually) just wires them:
```js
app.use('/api/procurement', require('./src/modules/procurement'));
app.use('/api/inventory', require('./src/modules/inventory'));
// …
```

## Extraction order (lowest risk first — each step tested before the next)

1. **database/** — `db` connection + `queryAsync` (everything depends on it).
2. **shared/** — pure helpers first: `format` (formatPdfMoney, formatTin, dates), `validation`
   (isValidEmail/Phone, normalizePhone/Tin), then `pdf` (PDF builders), `email`, `document-no`.
3. **middleware/** — `protectAdmin`, `protectSuperAdmin`, CSRF, multer `upload`.
4. **modules/** — one sub-module at a time, moving the matching `app.<verb>('/api/…')` routes
   out of server.js into the sub-module router. Test after each.

Rule: **never delete a route until its replacement is mounted and tested.** Keep `server.js`
running throughout.

## "Nothing left behind" checklist (server.js → target)

- [ ] DB pool + queryAsync → `database/`
- [ ] Auth/session/CSRF middleware → `middleware/`
- [ ] PDF builders (quotation/PO/PR/AR/voucher) → `shared/pdf`
- [ ] Email senders → `shared/email`
- [ ] Procurement routes (`/api/procurement/*`) → `modules/procurement/*`
- [ ] Inventory routes (`/api/inventory/*`) → `modules/inventory/*`
- [ ] Sales routes → `modules/sales/*`
- [ ] Projects routes → `modules/projects/*`
- [ ] AP routes (`/api/bills`, `/api/payments`, …) → `modules/accounts-payable/*`
- [ ] AR routes (`/api/receivables`, …) → `modules/accounts-receivable/*`
- [ ] Approvals → `modules/approval-center`
- [ ] Reports (`/api/reports`, `/api/transactions`) → `modules/reports`
- [ ] Master data (`/api/company-registry`, `/api/vendors`, requests) → `modules/master-data/*`
- [ ] Users/auth (`/api/admin/users`, `/login`, `/register`, `/api/me`) → `modules/users`
- [ ] Business entities (`/api/business-entities`) → `modules/business-entities`
- [ ] Notifications (`/api/notifications`) → `modules/notifications`
- [ ] Static page routes + React serving → keep in `server.js` entry (or `src/web.js`)

Status: skeleton created. Extraction begins at step 1 (database) — careful, tested per step.
