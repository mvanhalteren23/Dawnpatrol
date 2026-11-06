# Google Calendar connection: setup and Google verification

Everything needed to get clients' Google Calendar connection (Level 3) approved by Google.
The code, the privacy policy, the terms and the explainer page are done. These steps need your logins.
Total hands-on time: about 1.5 hours.

Live pages Google will check (after "update main"):
- Homepage: https://www.headabovedigital.com
- Privacy policy: https://www.headabovedigital.com/privacy
- Terms of service: https://www.headabovedigital.com/terms
- How the connection works: https://www.headabovedigital.com/google-calendar

**Before submitting:** read the privacy policy and terms and adjust anything that doesn't match how you
run the business. One point to confirm: if your Gemini (Google AI) key is on the free tier, Google may use
those prompts to improve its products; the paid tier doesn't. Calendar data is never sent to any AI.

---

## Step 1. Verify your domain (10 minutes)

1. Go to https://search.google.com/search-console and sign in with the Google account you'll use for
   Google Cloud (ideally matt@headabovedigital.com).
2. Add property → **Domain** → `headabovedigital.com` → Continue.
3. Copy the TXT record Google shows (starts with `google-site-verification=`).
4. Vercel → your team → **Domains** → headabovedigital.com → **DNS Records** → Add:
   Type `TXT`, Name `@`, Value = the text you copied → Save.
5. Back in Search Console press **Verify** (it can take a few minutes; try again if it fails at first).
6. While you're there: Sitemaps → submit `https://www.headabovedigital.com/sitemap.xml` (the SEO step).

## Step 2. Create the calendar-only Google app (15 minutes)

Keep this separate from the Google app the CRM already uses: that one asks for Gmail permissions, which
would force Google's much heavier "restricted" review.

1. https://console.cloud.google.com → project picker (top) → **New project**.
   Name: `Head Above Calendar` → Create, then select it.
2. **APIs & Services → Library** → search **Google Calendar API** → Enable.
3. **Google Auth Platform** (older consoles: OAuth consent screen) → Get started:
   - App name: `Head Above Digital`
   - User support email: team@headabovedigital.com
   - Audience: **External**
   - Contact email: matt@headabovedigital.com
   - Agree → Create.
4. **Branding**:
   - App logo: the square Head Above logo (PNG, 120×120)
   - Application home page: `https://www.headabovedigital.com`
   - Privacy policy link: `https://www.headabovedigital.com/privacy`
   - Terms of service link: `https://www.headabovedigital.com/terms`
   - Authorized domains: `headabovedigital.com`
   - Save.
5. **Data Access** → Add or remove scopes → tick exactly these, nothing else:
   - `.../auth/calendar.events`
   - `.../auth/calendar.freebusy`
   - `openid` and `.../auth/userinfo.email` (non-sensitive, needed to show which account is connected)
   - Update → Save.
6. **Audience** → Test users → add your own Gmail (and any friendly pilot client) so you can test before approval.
7. **Clients** → Create client → Application type **Web application** → Name `Head Above portal`:
   - Authorized redirect URI: `https://www.headabovedigital.com/api/google/calendar/callback`
   - Create → copy the **Client ID** and **Client secret** (keep the secret private).

## Step 3. Add the keys to Vercel (5 minutes)

Vercel → project **dawnpatrol** → Settings → **Environment Variables** → add, for Production:
- `GOOGLE_CALENDAR_CLIENT_ID` = the client ID
- `GOOGLE_CALENDAR_CLIENT_SECRET` = the client secret (mark it Sensitive)

Then Deployments → the latest production deployment → ⋯ → **Redeploy**.

## Step 4. Test it yourself (15 minutes)

1. In the CRM open a client receptionist (a test one is fine) → **Booking calendar** → **Connect Google Calendar**.
2. Sign in with a test user from step 2.6. Google shows "Google hasn't verified this app" (normal before
   approval): Advanced → Go to Head Above Digital → tick the calendar boxes → Continue.
3. The card should now say it books into that account's calendar.
4. Book a test appointment: call the line, or open the receptionist's public booking link. Check:
   - the time offered isn't one where the test calendar is busy;
   - the event lands on the test calendar;
   - the customer's invite comes from the test calendar's address.
5. Press **Disconnect calendar** and confirm https://myaccount.google.com/permissions no longer lists the app.

## Step 5. Record the demo video (20 minutes)

Unlisted YouTube video, 2–3 minutes, screen recording with no narration needed. Use English throughout.

1. **Start on https://www.headabovedigital.com** (shows the app's home and purpose), then scroll to the
   footer and click **Privacy** to show the policy is linked.
2. **Sign in to the client portal** as a client → **Your setup** → **Booking calendar** card.
3. Click **Connect Google Calendar**. On Google's screen:
   - **click the app name to show the developer info** (Google checks it matches);
   - **show the browser address bar** so the `client_id=...` in the URL is visible;
   - show the permissions listed (calendar events and availability), tick them, press **Continue**.
4. Back in the portal, show the card now says it's connected to that Google account.
5. **Show each permission in use:**
   - *calendar.freebusy:* put an event in the test Google Calendar (e.g. tomorrow 10–11am), then open the
     receptionist's public booking link and show that 10am isn't offered.
   - *calendar.events:* book a time on the booking link, then open Google Calendar and show the new event
     with the customer invited.
6. Back in the portal press **Disconnect calendar**, then show
   https://myaccount.google.com/permissions with the app gone.

Upload to YouTube as **Unlisted** and copy the link.

## Step 6. Submit for verification (15 minutes)

Google Auth Platform → **Verification Center** (or Audience → Publish app → Prepare for verification).
Press **Publish app** to move it out of testing, then fill in:

**App purpose (description):**
> Head Above Digital provides AI phone receptionists for small businesses. A business owner can connect
> their Google Calendar from our client portal so their AI receptionist can book customer appointments
> directly into it. When a customer calls and asks for an appointment, the receptionist checks the owner's
> free/busy times so it never offers a time the owner is busy, then creates the appointment as an event on
> the owner's calendar with the customer as a guest. If the customer reschedules or cancels, it updates or
> removes the event it created. Owners can disconnect at any time from the portal, which revokes access.

**Justification: `https://www.googleapis.com/auth/calendar.freebusy`**
> Before offering appointment times to a caller, the AI receptionist must know when the business owner is
> already busy so it never double-books them. We query free/busy for the booking window only (up to the
> next few weeks). This scope returns busy time ranges without any event titles, descriptions or
> attendees, which is the least information needed. Busy times are used at the moment of booking and not
> stored.

**Justification: `https://www.googleapis.com/auth/calendar.events`**
> When a caller books, the receptionist creates the appointment as an event on the owner's calendar, with
> the caller added as a guest so they receive the invitation from the owner's calendar. When the caller
> reschedules or cancels, we update or delete only the event our app created (we store its event ID). We
> need write access to events to do this; read-only scopes cannot create events, and the full
> `auth/calendar` scope (which also manages calendars and sharing) is broader than we need. We do not
> read, modify or delete events our app did not create.

**Why narrower scopes won't work (if asked separately):**
> `calendar.events.readonly` and `calendar.readonly` can't create the appointment events our feature
> exists for. `calendar.freebusy` alone can't create events. `calendar.events` is the narrowest scope that
> lets us add, update and remove the appointment events we book.

**Demo video:** the unlisted YouTube link from step 5.

**Data protection / handling (if asked):**
> OAuth refresh tokens are stored encrypted at rest (AES-GCM) in our database and are revoked with Google
> when the owner disconnects. Calendar data is not shared with third parties, not used for advertising,
> not used to train AI models, and not sent to any AI service. Our use of Google user data complies with
> the Google API Services User Data Policy, including the Limited Use requirements, as stated in our
> privacy policy at https://www.headabovedigital.com/privacy.

Submit. Google emails the contact address with any questions.

## Step 7. While Google reviews (3–5 business days; allow 1–3 weeks)

Common follow-ups and draft replies:

- **"Your privacy policy must disclose how you use Google user data."** →
  > The section "Google user data (Google Calendar)" at https://www.headabovedigital.com/privacy covers
  > what we access, how we use it, storage, sharing and deletion, and includes the Limited Use statement.
- **"The demo video doesn't show the OAuth consent screen / client ID."** → Re-record step 5.3 with the
  browser address bar visible on Google's consent page, and reply with the new link.
- **"Please reduce the scopes requested."** →
  > We request only calendar.freebusy (busy times, no event details) to avoid double-booking, and
  > calendar.events to create, update and delete the appointment events our app books. Read-only scopes
  > can't create events, and we don't request the broader auth/calendar scope.
- **"Domain ownership not verified."** → Finish step 1 for headabovedigital.com, then reply that it's done.

## Step 8. Switch it on

When Google approves: CRM → **Settings → Client calendars** → tick "Google has approved the calendar app"
→ Save. Clients then see **Connect Google Calendar (recommended)** in their portal; the built-in
calendar stays as the automatic backup.
