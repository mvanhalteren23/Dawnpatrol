# Next steps

## Clients' own Google Calendar: invites from the client's calendar (option 2)

Goal: a client connects their Google Calendar once in the portal; the receptionist checks their real
availability and books onto their calendar, so the invite comes from the client's own address.

### Why it needs Google's review
Letting other businesses connect their Google accounts means publishing the Google app as "External".
Google reviews every permission on the consent screen. Calendar permissions are "sensitive" (light
review: Google says typically 3–5 business days; allow 1–3 weeks). Our current Google connection also
asks for Gmail read/send, which are "restricted" (paid security assessment), so client calendar
connections must use a **separate, calendar-only Google app**.

### Build (Claude)
- [x] Privacy policy (/privacy, with the Google user data section and Limited Use statement), terms of
      service (/terms) and a Google Calendar connection page (/google-calendar), linked in the footer.
      Owner to review the wording.
- [x] Calendar-only connection (scopes `calendar.events`, `calendar.freebusy`, plus openid/email), using
      its own OAuth client when `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` are set
      (falls back to the main Google client until then). Redirect URI: `<APP_URL>/api/google/calendar/callback`.
- [x] Portal and CRM agent page: "Connect Google Calendar" and "Disconnect calendar"; bookings and
      availability use it (src/lib/booking-calendar.ts).
- [x] Revoke the Google token when a calendar is disconnected (or replaced).
- [x] Submission guide: docs/google-calendar-verification.md (Cloud setup, scope justifications, demo
      video script, test plan, draft replies to Google).

### Owner (Matt): follow docs/google-calendar-verification.md
- [ ] Verify headabovedigital.com in Google Search Console (DNS TXT record in Vercel).
- [ ] Create the second Google Cloud project/app (~10 minutes, with the guide).
- [ ] Record a ~2-minute demo video (unlisted YouTube): connect flow, consent screen with app name and
      client ID, a booking landing on the calendar.
- [ ] Submit for verification. Until approved: "testing" mode, up to 100 test users, 7-day tokens.

### Not chosen
- Sending through the client's Gmail account (restricted scope: paid annual security assessment).
- Reading their Gmail signature (restricted scope).
