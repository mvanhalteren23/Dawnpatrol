# Warm-up ping (faster answers after a quiet spell)

When no one has called for a few minutes, two things go to sleep: the Vercel server instance and
the Neon database (the free plan suspends it after about 5 minutes idle). The next caller waits
for both to wake before the agent answers, often an extra second or more.

A free Cloudflare Worker pings `https://headabovedigital.com/api/health/warm` every 4 minutes during
business hours. Each ping runs one tiny database query and keeps both awake.

## Set it up (Cloudflare dashboard, about 5 minutes)

1. **Vercel → Project → Settings → Environment Variables:** add `WARM_TOKEN` (Production, Sensitive)
   with a long random value. Redeploy (or wait for the next deploy).
2. **Cloudflare dashboard → Workers & Pages → Create → Create Worker.** Name it `headabove-warm`,
   press Deploy, then **Edit code**, paste the contents of `infra/cloudflare/warm-worker/worker.js`,
   and Deploy.
3. **The worker → Settings → Variables and secrets:**
   - `WARM_TOKEN` (type: Secret): the same value as in Vercel.
   - Optional (defaults shown): `WARM_URL` = `https://headabovedigital.com`, `WARM_TZ` =
     `America/Vancouver`, `WARM_START_HOUR` = `7`, `WARM_END_HOUR` = `19`, `WARM_DAYS` =
     `1,2,3,4,5,6` (Mon–Sat; 0 is Sunday).
4. **The worker → Settings → Trigger events → Add → Cron trigger:** `*/4 * * * *`.
5. Check it: the worker's **Logs** show a ping every 4 minutes in business hours, and
   `/api/health/warm` returns `{"ok":true,...}` with the token header.

Or with the CLI from `infra/cloudflare/warm-worker`: `npx wrangler deploy`, then
`npx wrangler secret put WARM_TOKEN`.

## Database hours (important on the Neon free plan)

Keeping the database awake uses Neon compute hours. The free plan has a monthly allowance, so the
worker only pings in business hours (Mon–Sat 7am–7pm Pacific by default: roughly 310 hours a month at
the smallest compute size). Check **Neon → Project → Usage** a week after turning it on. If it's
running close to the allowance, shorten `WARM_START_HOUR`/`WARM_END_HOUR` or drop Saturday. Once
there are about 10 paying clients, a paid Neon plan with "scale to zero" turned off removes the
database wake-up entirely, and the ping then only keeps Vercel warm.

Without `WARM_TOKEN` set in Vercel the route answers anyone (it only runs `SELECT 1`), so set it.
