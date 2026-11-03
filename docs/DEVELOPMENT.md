# How changes get to production

```
work branch ──push──▶ CI (type-check + tests)  +  Vercel preview (preview database)
     │                         both green, preview checked
     └──── merge (pull request) ──▶ main ──▶ Vercel production (live database)
```

| Stage | Where | Data |
|---|---|---|
| Dev | a work branch (never `main` directly) | none |
| Test | GitHub Actions **CI** on every push; a Vercel **preview** for every work branch | Neon branch `preview` (a copy, never the live data) |
| Prod | `main` → Vercel production → headabovedigital.com | Neon `main` |

Previews have no Twilio, ElevenLabs, Google or Stripe keys (those are set for Production only), so
a preview can't call, text, email or charge anyone. Crons and the GitHub sweeps only hit production.

## Releasing

1. Push to the work branch. Wait for the green **CI** tick and open the **Vercel preview** link.
2. Check the change on the preview.
3. Open a pull request into `main` and merge it. Vercel deploys production in a few minutes.
4. Something wrong? Vercel → Deployments → the previous production deployment → **Promote**
   (instant rollback). Database changes are not rolled back by this: see below.

## Database changes (migrations)

The database schema is `prisma/schema.prisma`; every change to it ships as a migration in
`prisma/migrations/`, applied by `prisma migrate deploy` during the Vercel build: first on the
preview database (the test), then on production when merged.

To make one (a local Postgres is used as the scratch "shadow" database):

```
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url postgresql://postgres@127.0.0.1:55432/shadow \
  --script > prisma/migrations/$(date -u +%Y%m%d%H%M)_short_name/migration.sql
```

Read the SQL before committing. Anything that drops a table or column, or makes a column
required, needs a plan (copy the data first, or do it in two releases) and a fresh backup.

`0_init` is the starting point: the live database already had it when migrations began
(recorded in `_prisma_migrations`), so it is never re-run there.

## Free-plan notes

- GitHub Free has no required checks on private repositories: merge only when CI is green.
- GitHub Actions minutes (2,000/month): CI ~2 min per push, call-audit sweeps ~800/month,
  backups ~90/month. Turn off the Call audits workflow between audits to save minutes.
- When going commercial: Vercel Pro (Hobby is non-commercial), move the call-audit sweep to a
  Vercel cron, and consider GitHub Pro for required checks.
