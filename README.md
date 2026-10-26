# AI Receptionist Agency — CRM & Client Portal

The operating system for Head Above Digital, which builds AI receptionists for small and medium businesses so they never miss a call or lose a customer.

**The goal it's built around:** get to 30–50 clients paying monthly. The dashboard tracks paying clients against that goal, along with MRR, pipeline, follow-ups due and client calls that still need a follow-up.

| Area | What it does |
| --- | --- |
| **Prospecting CRM** | Accounts and contacts, a 10-stage pipeline board (Prospect → Active → Churned), tags, fit scores, tasks and follow-up dates. |
| **Bulk upload** | CSV import that maps Apollo, ZoomInfo, Google Maps and HubSpot headers automatically. Rows are de-duplicated by domain, or by name + city, and contacts merge into the same account. |
| **Claude prospecting** | Saved prompts with criteria ("HVAC in Denver, 2–20 staff"). Claude searches the web, scores fit and lists prospects. You tick the ones to add, optionally with research queued for each. |
| **Claude account research** | Saved research prompts with `{{variables}}`. They run on one account or in bulk. Each run gives a cited report plus structured fields (fit score, missed calls per week, job value, pain signals, decision makers, opener), saved as a Google Doc. |
| **Email writer** | AI drafts outreach emails from saved email prompts plus optional one-off instructions. Rate each draft 👍/👎 with feedback, or redraft with that feedback. Every draft follows a house style guide and automatically learns from recent feedback, drafts you rewrote before sending, and emails that got replies; **Suggest updates from feedback** proposes a revised style guide for you to approve (Outreach → Email writer). |
| **Automatic outreach tracking** | Gmail sync every 30 min matches mail to contacts by email or company domain. Emails sent from the CRM track opens and clicks. A webhook takes events from Instantly, Lemlist, Smartlead or Zapier. Stage, last-touch and follow-up dates update themselves, and each account gets an outreach log in Drive. |
| **Google Drive folder system** | Each account gets its own folder, filed under `01 Prospects`. It moves to `02 Clients` when the account converts, which adds the contracts, knowledge-base, call-log and billing folders. |
| **Billing** | Plans, Stripe Checkout links, a Stripe customer portal and webhooks that sync subscriptions and invoices. Manual (ACH) clients count toward MRR too. Subscription status moves the account stage: active → Onboarding/Active, past due → Past due, canceled → Churned. |
| **AI receptionist + RAG** | Per-client receptionist settings and a categorised knowledge base. Claude can draft the knowledge base from the client's website; drafts stay inactive until you approve them. The knowledge base syncs to ElevenLabs (agent and documents), has a search endpoint for an ElevenLabs webhook tool, and has an export for Claude. A test-call chat answers through Claude using the same knowledge. |
| **Demo line** | One shared Twilio number with a directory. A prospect calls, enters their extension, and the CRM hands the call to the ElevenLabs demo agent built for their business. The call is logged on their account and moves the stage to Engaged. Outreach prompts can include `{{demo_phone}}` and `{{demo_extension}}`. |
| **Business line** | For clients on their cell: a new local Twilio number they publish. Each call rings the owner's cell first with a "press 1 to answer" screen (so their voicemail can't take it), then the AI receptionist answers if they don't. Ringing can follow bookable hours. Texts to the number are forwarded to the cell, and follow-up texts are sent from it. Set up from the receptionist page in one click. |
| **Dialer** | Browser calling (Twilio Voice SDK) from the account page and a power-dialer page of active prospects, sortable by last touch, fit score, follow-up due or missed calls. One click per call; after hanging up, pick an outcome and next steps (tasks queued with due dates, next follow-up set, booked → meeting, not interested → Lost). Calls are recorded and, with Gemini, transcribed and summarised onto the timeline with a suggested next step. One-click setup in Settings creates the TwiML App and API key. |
| **Client portal** | Clients log in to see calls answered, bookings and leads waiting on them. They can edit their own knowledge base, test their receptionist and view invoices or manage payment. |

## Stack

Next.js 15 (App Router, server actions) · TypeScript · Prisma + Postgres · Tailwind · `@anthropic-ai/sdk` · Stripe · Google OAuth (Drive + Gmail + Calendar REST) · Gemini (`@google/genai`) · ElevenLabs Conversational AI REST.

## Quick start

```bash
cp .env.example .env          # set AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD at minimum
docker compose up -d db       # local Postgres (or point DATABASE_URL at any Postgres)
npm install
npx prisma db push            # create the tables
npm run db:seed               # admin user, starter prompts, Starter/Growth/Pro plans
SEED_DEMO=1 npm run db:seed   # optional: sample prospects + a demo client with calls
npm run dev                   # http://localhost:3000
```

Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. The company name shown everywhere is set in **CRM → Settings → Company** (fallback: `COMPANY_NAME`, default "Head Above Digital"). To give a client portal access, open their account and use **Client portal access**.

```bash
npm test          # unit tests (CSV mapping, RAG retrieval, outreach rules, signatures, metrics)
npm run typecheck
npm run build
```

## Connecting the integrations

Each integration is optional. Features that need a missing key turn themselves off, and **CRM → Settings** shows the status of each one.

### AI models: Claude and Gemini (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`)
- Every AI job goes through one router (`src/lib/ai`). **CRM → Settings → AI models** picks the provider and model per job (account research, prospect search, knowledge base from website, structured fields, outreach emails, caller summaries, test chat) with an optional fallback. Changes apply immediately, no deploy.
- **Defaults:** with `GEMINI_API_KEY` set, the three web-research jobs run on Gemini (`gemini-flash-latest`, grounded with Google Search and page reading) with Claude as the fallback; everything else runs on Claude (`claude-sonnet-5-5`, or `CLAUDE_MODEL`) with Gemini as the fallback.
- Claude research uses the server-side `web_search` / `web_fetch` tools (capped at a few searches and page reads per run); structured fields use a low-effort structured-output pass. Requests opt in to server-side refusal fallback.
- Every call is logged (`AiUsage`) and summarised on the settings page with a Claude cost estimate.
- Long runs happen in the background with Next's `after()`, and pages refresh themselves while a run is `RUNNING`.

### Google Drive + Gmail
1. In Google Cloud Console, create an OAuth client of type **Web application** and enable the **Drive API** and **Gmail API**.
2. Set the redirect URI to `${APP_URL}/api/google/callback`, and put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
3. Go to **CRM → Settings → Connect Google**. This works with a personal @gmail.com account.
4. Scopes requested:
   - `drive.file`: the app only sees folders and files it creates itself.
   - `gmail.readonly`: for outreach tracking.
   - `gmail.send`: for tracked sends.
   - `calendar.freebusy` and `calendar.events`: for receptionist availability and booking.
5. If the OAuth app stays in "Testing" mode, add yourself as a test user. Google expires refresh tokens for testing-mode apps after 7 days, so publish the app (it can stay internal/unverified for your own account) to avoid reconnecting every week.

The folder structure the app creates:

```
<Company name> — CRM/
  00 Company/
  01 Prospects/<Account (domain)>/01 Research, 02 Outreach
  02 Clients/<Account (domain)>/01 Research … 04 Knowledge Base (RAG), 05 Call Logs, 06 Billing
```

### Outreach tracking
- **Gmail:** `GET /api/cron/outreach-sync` with `Authorization: Bearer $CRON_SECRET`. `vercel.json` schedules it daily so the deploy works on any Vercel plan; on Pro change it to `*/30 * * * *`. You can also run `npm run jobs:outreach-sync`, or use **Sync Gmail now** on the Outreach page.
- **Sequencers / Zapier:** `POST /api/webhooks/outreach` with header `x-webhook-secret: $OUTREACH_WEBHOOK_SECRET`. The body is one event or an array:
  ```json
  {"id":"evt_1","event":"email_sent","email":"owner@acme.com","company":"Acme","website":"acme.com","subject":"…","createIfMissing":true}
  ```
  Events: `email_sent`, `email_replied`, `email_opened`, `email_clicked`, `call`, `call_inbound`, `sms`, `sms_reply`, `linkedin`, `linkedin_reply`, `meeting_booked`. The `id` makes deliveries idempotent.
- **Automatic rules:**
  - The first outbound touch moves a prospect to Contacted, and the first reply moves it to Engaged.
  - After an outbound touch with no reply, a follow-up is due in 3 days.
  - A reply marks the email thread as replied.

### ElevenLabs
- Set `ELEVENLABS_API_KEY`. `ELEVENLABS_DEFAULT_VOICE_ID` and `ELEVENLABS_LLM` are optional; `ELEVENLABS_LLM` sets the LLM id ElevenLabs runs the agent on, for example one of their Claude options.
- **Sync to ElevenLabs** on a receptionist does three things:
  1. It compiles the active knowledge base into one text document per category.
  2. It uploads those documents and creates or patches the agent with the system prompt, greeting, voice and document references.
  3. It deletes the previous set of documents.
- **Live lookups (optional):** add a webhook tool to the agent: `GET ${APP_URL}/api/rag/<receptionistId>/search?q={query}` with the header `Authorization: Bearer <RAG token>`. The token is shown on the receptionist page.
- **Calendar booking:** turn it on in a receptionist's **Calendar booking** card (bookable hours, length, buffer, notice, meeting type — phone, Google Meet or caller's choice — and questions to ask before booking). If the caller wants a confirmation text, it's sent through Twilio from `TWILIO_SMS_FROM` (default: the demo number). On sync the agent gets two webhook tools, `POST ${APP_URL}/api/agent-tools/<id>/availability` and `/book`, authorised with the RAG token. They read free/busy from the connected Google Calendar and create the event. Each booking is re-checked against the calendar before it's created, and can optionally add the caller to the CRM: it matches an existing account by contact email, company email domain, phone or business name, otherwise creates one and runs your default research prompt on it in the background. Either way the account is flagged for review, and a banner across the CRM lists accounts waiting to be reviewed (saving the account or clicking **Mark reviewed** clears it). Bookable hours can skip B.C. statutory holidays and any extra closed dates. A client's calendar works if they share it with the connected Google account and its address is set as the calendar.
- **Caller follow-ups:** per receptionist (CRM booking card or the client portal's **Settings** page), send the caller a booking confirmation and/or a call summary by text (Twilio, from `TWILIO_SMS_FROM` or the demo number) or email (the connected Gmail), or let the caller choose. Call summaries are written by Claude from the transcript. Sent messages are logged and shown in the portal. The client portal's Settings page also lets clients set their bookable hours, holidays and closed days.
- **Call logs:** in ElevenLabs, set the post-call webhook to `${APP_URL}/api/webhooks/elevenlabs` and put its secret in `ELEVENLABS_WEBHOOK_SECRET`. Each call becomes a CallLog with an outcome (booked, message taken, transferred, missed opportunity…) and appears in both the CRM and the client portal. Calls are also appended to a monthly Call Log doc in the client's Drive folder.
- Outcome detection uses a `data_collection_results.outcome` field if you configure one in the agent. Otherwise it falls back to keyword rules (`src/lib/calls.ts`).
- The request shapes in `src/lib/elevenlabs.ts` follow ElevenLabs' Conversational AI REST API (`/v1/convai/agents/create`, `/v1/convai/agents/{id}`, `/v1/convai/knowledge-base/text`). Check them against your account's API version the first time you sync.

### Knowledge base for Claude
- `GET /api/rag/<id>/export?format=markdown|json` returns the compiled knowledge base and the receptionist system prompt. Use it in Claude Projects or any Claude pipeline.
- The in-app test chat sends the same content to Claude as a cached system prompt.

### Stripe
- Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- Point a Stripe webhook at `${APP_URL}/api/webhooks/stripe` with these events: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.finalized|paid|payment_failed|voided|marked_uncollectible`.
- Put each plan's Stripe price id on the plan (CRM → Billing).
- On an account, **Stripe checkout link** creates a hosted checkout link to send to the client.

## Deploying

Step-by-step guide for Vercel + Neon on www.dawnpatrol-tech.com: **[DEPLOY.md](DEPLOY.md)**. On Vercel, each build applies the schema and runs the idempotent seed (`vercel-build`), so there are no manual database steps.

## Code map

```
prisma/schema.prisma        data model (accounts → contacts, activities, research, subscription, receptionists → knowledge, calls)
src/lib/ai/                  AI router + Claude/Gemini adapters (research, prospects, KB drafting, emails, summaries, test chat)
src/lib/jobs.ts             background research/prospecting/KB-draft runs
src/lib/rag.ts              KB compilation, receptionist prompt, BM25 retrieval
src/lib/elevenlabs.ts       agent + KB sync
src/lib/outreach.ts         activity recording + automatic rules, Gmail sync, tracked send, Drive outreach log
src/lib/drive.ts            Drive folder system + Google Doc writer
src/lib/billing.ts          Stripe checkout/portal/webhook sync, manual billing
src/lib/csv.ts, importer.ts bulk upload
src/app/crm/**              CRM (admin) pages + server actions
src/app/portal/**           client portal
src/app/api/**              webhooks, tracking, RAG, cron, OAuth
```
