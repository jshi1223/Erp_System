# PostgreSQL / Supabase Runtime

This project uses PostgreSQL at runtime through `DATABASE_URL`. The legacy SQL translator has been removed, and backend SQL should be written in PostgreSQL syntax.

## Recommended Target

- App hosting: Vercel or another Node host
- Database: Supabase PostgreSQL
- File storage: Supabase Storage for PDF attachments
- Database driver: `pg`
- Auth/session: keep app auth first, then improve later

## Local PostgreSQL Runtime

1. Create a PostgreSQL database named `kinaadman`.
2. Add PostgreSQL environment variables:

```env
DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/kinaadman
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-with-service-role-key
SUPABASE_STORAGE_BUCKET=uploads-pdf
```

3. Import schema migrations into PostgreSQL/Supabase:

```bash
npm run postgres:migrate
```

Or use the setup alias:

```bash
npm run postgres:setup
```

4. Start the app:

```bash
npm start
```

5. Verify row counts and core workflows in PostgreSQL.

Local setup note: PostgreSQL is installed at `C:\Program Files\PostgreSQL\17`, and `psql` was added to the user PATH. Open a new terminal before using plain `psql`.

## Backend Adapter

The runtime path uses `lib/db/postgres-app.js` to keep existing `db.query(sql, params, callback)` routes working while sending native PostgreSQL SQL to `pg`:

- `?` placeholders are converted to PostgreSQL positional placeholders.
- Callback-style `insertId` and `affectedRows` result fields are preserved for existing routes.
- SQL strings in application code should stay PostgreSQL-native.

Long term, routes should move to one shared query helper:

```text
lib/db/index.js
```

Then routes should call one shared query helper instead of raw legacy SQL calls.

Suggested adapter API:

```js
await dbQuery(sql, params)
await dbOne(sql, params)
await dbRun(sql, params)
await withTransaction(async (client) => {})
```

## Phase 4 - PDF Storage

Current code saves PDFs in:

```text
uploads_pdf/
```

This will not work reliably on Vercel because runtime file storage is not persistent. Move PDFs to Supabase Storage:

- bucket: `uploads-pdf`
- store DB value as storage path instead of local filename
- update PDF endpoints to stream/download from Supabase Storage

Affected modules:

- projects
- transactions
- service orders
- AP bills

## Phase 5 - Test Checklist

After PostgreSQL conversion, verify:

- Login/logout
- User management
- Business entities
- Company registry
- Projects
- Transactions
- Service orders
- Accounts Receivable
- Accounts Payable
- Purchase Requisition approval
- Purchase Order approval
- Goods receipt flow
- Payments
- Reports
- PDF upload/view/download
- System logs

Run:

```bash
npm test
npm run check
```

## Practical Recommendation

Do not migrate the whole system in one edit. The safest order is:

1. Create PostgreSQL schema.
2. Import data into Supabase.
3. Add a PostgreSQL DB adapter.
4. Convert read-only routes first.
5. Convert write routes module by module.
6. Move PDFs to Supabase Storage.
7. Deploy to Vercel only after local PostgreSQL testing works.

## Estimated Work

- PostgreSQL schema conversion: 1-2 days
- Data migration: 1 day, depending on dirty data
- Backend query conversion: 4-7 days
- PDF storage migration: 1-2 days
- Vercel deployment/testing: 1-2 days

Total realistic estimate: 1-2 weeks.
