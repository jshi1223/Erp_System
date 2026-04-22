# Deployment Checklist

## Required environment values
- `NODE_ENV=production`
- `APP_BASE_URL=https://your-domain.example`
- `SESSION_SECRET` set to a long random string
- Database credentials for production MySQL
- SMTP settings if you want email reset links
- `ALLOW_LEGACY_PLAINTEXT_PASSWORDS=false`

## Before deploy
- Copy `.env.example` to `.env` and fill in real values
- Make sure all user passwords are stored as bcrypt hashes
- Confirm the `uploads_pdf` folder is writable
- Back up the database first
- Run the app locally and check login, reset password, AP/AR, inventory, and project pages

## Security checklist
- Keep `SESSION_SECRET` private
- Use HTTPS in production
- Disable legacy plaintext passwords in production
- Keep rate limiting enabled
- Review admin/staff permissions before exposing the app publicly
- Keep regular database backups

## Notes
- The app uses an in-memory session store by default. For a larger production deployment, replace it with a persistent session store.
- If SMTP is not configured, password reset will return a development reset link instead of sending email.
