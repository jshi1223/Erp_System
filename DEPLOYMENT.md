# Deployment Checklist

## Required environment values
- `NODE_ENV=production`
- `APP_BASE_URL=https://your-domain.example`
- `SESSION_SECRET` set to a long random string
- `SESSION_INACTIVITY_TIMEOUT_MS` idle auto-logout timeout in milliseconds, for example `1800000` for 30 minutes
- `DATABASE_URL` for production PostgreSQL
- `PGSSLMODE=require` when using Supabase pooled/direct PostgreSQL
- SMTP settings if you want email reset links
- `ALLOW_LEGACY_PLAINTEXT_PASSWORDS=false`

## Before deploy
- Copy `.env.example` to `.env` and fill in real values
- Make sure all user passwords are stored as bcrypt hashes
- Confirm the `uploads_pdf` folder is writable
- Back up the database first
- Run the app locally and check login, reset password, AP/AR, and project pages

## Security checklist
- Keep `SESSION_SECRET` private
- Use HTTPS in production
- Disable legacy plaintext passwords in production
- Keep rate limiting enabled
- Review admin/staff permissions before exposing the app publicly
- Keep regular database backups

## Notes
- The app uses PostgreSQL for runtime data and sessions through `DATABASE_URL`.
- If SMTP is not configured, password reset will return a development reset link instead of sending email.

## Render + Supabase
- Create a Supabase project and copy the PostgreSQL connection string from Supabase Database settings.
- In Render, create the web service from this GitHub repository or use `render.yaml`.
- Set `DATABASE_URL` to the Supabase PostgreSQL connection string.
- Set `PGSSLMODE=require`.
- Set `APP_BASE_URL` to the Render service URL, for example `https://kinaadman-erp.onrender.com`.
- Keep Supabase passwords and service keys in Render environment variables only. Do not commit them to GitHub.
- Render runs `npm run render:start`, which applies PostgreSQL migrations before starting the app.
