# Next steps (saved, not started)

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
- [ ] Privacy policy page (incl. Google API Services User Data Policy "Limited Use" statement) and
      terms of service page on headabovedigital.com, linked from the homepage footer. Owner to review.
- [ ] Separate OAuth client for client calendar connections, scopes only
      `calendar.events` and `calendar.freebusy`.
- [ ] Portal: "Connect your calendar" and "Disconnect calendar"; bookings and availability use it.
- [ ] Revoke the Google token when a calendar is disconnected.
- [ ] Submission guide: per-scope justifications, consent-screen settings, demo video script.

### Owner (Matt)
- [ ] Verify headabovedigital.com in Google Search Console (DNS TXT record in Vercel).
- [ ] Create the second Google Cloud project/app (~10 minutes, with the guide).
- [ ] Record a ~2-minute demo video (unlisted YouTube): connect flow, consent screen with app name and
      client ID, a booking landing on the calendar.
- [ ] Submit for verification. Until approved: "testing" mode, up to 100 test users, 7-day tokens.

### Not chosen
- Sending through the client's Gmail account (restricted scope: paid annual security assessment).
- Reading their Gmail signature (restricted scope).
