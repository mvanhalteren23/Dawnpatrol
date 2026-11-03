# Recovery plan

What to do if the database is lost, corrupted or wrongly changed. Practise steps 1–4 once a
quarter (restore into a test branch, not the live one) and note the date at the bottom.

## What protects the data

| Layer | What it covers | Where |
|---|---|---|
| Neon point-in-time restore | Any moment in the last 6 hours (free plan; 7 days on Neon Launch) | Neon console → Branches → Restore |
| Nightly encrypted backup | A full copy every night, kept 30 days, restore-tested each night | GitHub → Actions → Database backup → artifacts |
| Source code | All app code and settings history | GitHub repository |
| App settings and keys | Environment variables | Vercel → Settings → Environment Variables (keep a copy in your password manager) |

Recordings and transcripts also live at ElevenLabs; Twilio keeps its own call records.

## Restore a mistake from the last few hours (fastest)

Neon console → the project → Branches → main → **Restore** → pick a time just before the problem →
restore to a **new branch** first, check it, then restore the main branch.

## Restore from the nightly backup

1. GitHub → Actions → **Database backup** → open the night you want → download the artifact and unzip it.
2. Decrypt it (you need BACKUP_PASSPHRASE from your password manager):
   ```
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in headabove-db-YYYY-MM-DD.dump.enc -out db.dump
   ```
3. Create an empty database: Neon console → New branch (or new project) → copy its **direct** connection string.
4. Restore into it (Postgres 18 tools; Docker works anywhere):
   ```
   docker run --rm -v "$PWD:/w" postgres:18 pg_restore --clean --if-exists --no-owner --no-privileges -d "<connection string>" /w/db.dump
   ```
5. Check it: sign in to a preview, or count rows in Account, CallLog and User.
6. Switch the app: Vercel → Settings → Environment Variables → DATABASE_URL = the new connection
   string → Redeploy. Calls, the CRM and the portal now run on the restored data.
7. Record what happened in CRM → Security & breaches if personal information was affected.

## Restore tests

- Every night: the backup job restores the dump into a fresh Postgres and counts the rows (GitHub → Actions → Database backup → "Test the restore").
- Manual practice (steps 1–5 into a test branch): _date and result here_
