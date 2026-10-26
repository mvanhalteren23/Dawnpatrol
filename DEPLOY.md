# Deploying to www.dawnpatrol-tech.com

Recommended setup: **Vercel** (hosting) + **Neon** (Postgres, added from inside Vercel) + your domain.
It takes about 20 minutes. Every build applies the database schema and seeds the admin user, starter prompts and plans automatically (the seed is idempotent).

## 1. Create the project on Vercel

1. Sign in at vercel.com with GitHub. You can start on the free **Hobby** plan with Neon's free tier (see "Starting free, upgrading later" at the end).
2. **Add New → Project → Import** `mvanhalteren23/Dawnpatrol`.
3. Merge the branch `ccr-7d97a892-a45wpz` into `main` first, or choose it as the production branch under Settings → Git.
4. Framework preset: **Next.js**. Leave the build command blank; `vercel-build` in `package.json` is used automatically.

## 2. Add the database

1. In the project, open **Storage → Create Database → Neon (Postgres)**, then connect it to the project.
2. Vercel adds `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct).
3. Add one more variable, `DIRECT_DATABASE_URL`, set to the value of `DATABASE_URL_UNPOOLED`.

## 3. Environment variables

Add these under **Settings → Environment Variables**, for Production:

| Variable | Value |
|---|---|
| `APP_URL` | `https://www.dawnpatrol-tech.com` |
| `AUTH_SECRET` | 40+ random characters (`openssl rand -base64 48`) |
| `CRON_SECRET` | another random string. Vercel cron sends it automatically. |
| `ADMIN_EMAIL` | your login email |
| `ADMIN_PASSWORD` | your first password. Required: the build fails without it. |
| `ANTHROPIC_API_KEY` | from console.anthropic.com |
| `ELEVENLABS_API_KEY` | ElevenLabs → Developers → API Keys |
| `ELEVENLABS_WEBHOOK_SECRET` | from step 5 (add it after creating the webhook, then redeploy) |
| `ELEVENLABS_DEFAULT_VOICE_ID` | optional |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | step 6 |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | optional, step 7 |
| `OUTREACH_WEBHOOK_SECRET` | random string, if you use Instantly/Lemlist/Zapier |

Then click **Deploy**.

## 4. Point the domain

1. In Vercel, open **Settings → Domains**. Add `www.dawnpatrol-tech.com`, and also `dawnpatrol-tech.com` set to redirect to www.
2. At your domain registrar (wherever dawnpatrol-tech.com was bought), add the records Vercel shows. Usually:
   - `CNAME  www  →  cname.vercel-dns.com`
   - `A      @    →  76.76.21.21`
3. HTTPS is issued automatically once DNS resolves. This takes minutes, occasionally a few hours.

> If `www.dawnpatrol-tech.com` already hosts your marketing site, put the CRM on `app.dawnpatrol-tech.com` instead. Use that hostname everywhere below and in `APP_URL`.

## 5. Connect ElevenLabs

1. In ElevenLabs, open **Agents Platform → Settings → Webhooks** (post-call webhook). Set the URL to `https://www.dawnpatrol-tech.com/api/webhooks/elevenlabs` and enable transcription events.
2. Copy the secret it shows into `ELEVENLABS_WEBHOOK_SECRET`, then redeploy (**Deployments → ⋯ → Redeploy**).
3. In the CRM, open an account and click **+ Receptionist**. Fill in the knowledge base, then click **Sync to ElevenLabs**. This creates the agent.

## 5b. Demo line (+1 778-650-4870)

The demo number is a directory: callers enter an extension and reach the demo receptionist for that prospect.

1. Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_DEMO_NUMBER=+17786504870` in Vercel, then redeploy.
2. In Twilio Console, go to **Phone Numbers → Active numbers → +1 778-650-4870 → Voice configuration**. Set **A call comes in** to **Webhook**, `https://www.dawnpatrol-tech.com/api/voice/demo`, **HTTP POST**. Enter it exactly: Twilio signs that URL, and the CRM rejects requests whose signature doesn't match.
3. In ElevenLabs **Phone Numbers**, leave this number **unassigned**. Assigning an agent there points the number back at ElevenLabs and bypasses the directory.
4. For each prospect: on their account, add a receptionist with **Demo for this prospect** ticked (it gets the next free extension, starting at 101). Click **Draft KB from website**, approve the drafts, then click **Sync to ElevenLabs**.
5. **CRM → Demo line** lists every extension, whether its agent is ready, and its demo calls.

## 5c. Business lines (ring the owner's cell first)

On a receptionist, **Business line → Get business line** buys a local number in the area code you enter (or attaches one already on your Twilio account) and points its voice and SMS webhooks at `${APP_URL}/api/voice/business` and `/api/sms/business`. Nothing to configure in Twilio or ElevenLabs by hand. Leave these numbers **unassigned** in ElevenLabs, like the demo line. The Twilio account must be upgraded (trial accounts can't buy numbers or call unverified cells).

## 5d. Dialer

CRM → Settings → Dialer → **Set up dialer** creates a TwiML App (Voice URL `${APP_URL}/api/voice/outbound`) and an API key on your Twilio account; nothing to do in the Twilio Console. Caller ID is `DIALER_CALLER_ID`, else `TWILIO_DEMO_NUMBER`. The Twilio account must be upgraded, and voice geo permissions must allow Canada/US (the default). Calls are recorded; with `GEMINI_API_KEY` set they're transcribed and summarised automatically.

## 6. Connect Google (Drive folders, Gmail tracking, Calendar booking)

1. In console.cloud.google.com, create a project. Enable the **Google Drive API**, **Gmail API** and **Google Calendar API**.
2. Open **APIs & Services → OAuth consent screen**:
   - Choose External.
   - Add yourself as a test user.
   - Publish the app so tokens don't expire after 7 days.
3. Open **Credentials → Create OAuth client → Web application**. Set the authorized redirect URI to `https://www.dawnpatrol-tech.com/api/google/callback`.
4. Put the client ID and secret in Vercel, then redeploy.
5. In the CRM, go to **Settings → Connect Google**. If you connected before Calendar was added, connect again to grant Calendar access.
6. On a receptionist, fill in **Calendar booking**, tick **Let the agent check availability and book**, click **Preview openings** to check, then **Sync to ElevenLabs**. The sync adds two webhook tools to the agent: `get_available_times` and `book_appointment`.

## 7. Stripe (optional)

1. In Stripe, open **Developers → Webhooks → Add endpoint**. Use `https://www.dawnpatrol-tech.com/api/webhooks/stripe` with these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, `invoice.marked_uncollectible`.
2. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`, then redeploy.
3. In **CRM → Billing**, paste each plan's Stripe price id.

## 8. Check it

- `https://www.dawnpatrol-tech.com/login` loads. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- **CRM → Settings** shows every integration as configured.
- Make a test call to the Twilio number. It should appear under the receptionist's **Recent calls** within a minute of hanging up.

## Gmail sync schedule

`vercel.json` runs the Gmail sync once a day, because Vercel's Hobby plan rejects anything more frequent. On Pro, change the schedule to `*/30 * * * *`. **Sync Gmail now** on the Outreach page works any time.

## Starting free, upgrading later

Hobby + Neon free runs everything, with these limits:

- **Gmail sync runs once a day.** Use **Sync Gmail now** on the Outreach page between runs.
- **Long Claude runs can be cut off.** Research and prospect searches are allowed up to 300 seconds (`maxDuration` in `src/app/crm/layout.tsx`). If a deploy rejects that value on your plan, lower it to `60`. Large prospect searches may then stop early, so ask for 5–10 prospects at a time.
- **Vercel's terms say Hobby is for non-commercial use.** Treat it as the pilot setup and upgrade before paying clients depend on it.

**Upgrading Vercel:** go to **Settings → Billing → Upgrade to Pro**. The project, domain, environment variables and database all stay as they are. Afterwards, change the schedule in `vercel.json` to `*/30 * * * *` and push.

**Upgrading Neon:** upgrade in the Neon console if you outgrow the free storage or compute. The connection strings don't change.
