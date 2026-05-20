# Supabase + Render Setup

This project is ready to run against Supabase PostgreSQL through `DATABASE_URL`.

## 1. Supabase

1. Create a Supabase project.
2. Open Project Settings > Database.
3. Copy the PostgreSQL connection string.
4. Use the connection string as the Render `DATABASE_URL`.
5. Set `PGSSLMODE=require`.

Use the pooled connection string if Supabase recommends it for hosted apps. Keep the password private.

## 2. Render

The repository includes `render.yaml`.

Required Render environment values:

```text
DATABASE_URL=postgresql://...
PGSSLMODE=require
APP_BASE_URL=https://your-render-service.onrender.com
NODE_ENV=production
ALLOW_LEGACY_PLAINTEXT_PASSWORDS=false
```

Optional email values:

```text
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
APPROVAL_NOTIFY_EMAILS=
```

## 3. Database Migration

Render starts the app with:

```bash
npm run render:start
```

That command runs:

```bash
npm run postgres:migrate
npm start
```

The migrations in `migrations/postgres` create and update the Supabase PostgreSQL schema.

## 4. Local Check

Before deploying:

```bash
npm run check
npm test
```
