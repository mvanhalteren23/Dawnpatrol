# Missed-call audit (paused offer)

Removed from what Grace offers callers on Nov 22, 2026. Kept here for later. The audit tool itself
is still in the CRM (Call audits) and can be used internally at any time.

## What it was

A free audit of how a business handles its calls, used to open a sales conversation:

- **The pitch:** "We'll call your business over the next week, the way your customers do, and send
  you a one-page report of what they hear and what the missed calls are likely costing you."
- **How Grace sold it:** callers could book a free 20-minute call (phone or Google Meet) to go
  through the audit and the AI receptionist.
- **Nothing changes on their side:** we call their public number; we don't touch their phone line.

## How the audit works (CRM → Call audits)

1. Pick the business, its industry (auto repair, other service business) and its open hours.
2. The CRM plans a week of calls at different times of day, including after hours, each with a
   realistic customer scenario (a brake noise, a quote request, "are you open Saturday?").
3. Twilio calls their number. If a person answers, our audit caller agent plays the scenario. If it
   goes to voicemail, the call hangs up and we record that it went to voicemail.
4. Every answered call is transcribed and summarised: was it answered, how fast, was the question
   handled, was a booking offered.
5. At the end, the report gives the answer rate, after-hours coverage, what callers heard, facts
   learned about the business (useful for their receptionist's knowledge base) and an estimated
   monthly cost of missed calls (missed calls × share of new customers × booking rate × average job
   value).
6. The audit page shows an estimate of what the audit itself costs to run (Twilio, ElevenLabs and AI
   minutes) before you start it.

## To bring it back

1. In Grace's settings (CRM → Receptionists & RAG → Grace), remove the line "Never offer or mention
   a missed-call audit…" from the extra instructions.
2. Add a knowledge base entry describing the offer (use "The pitch" above) and when to offer it.
3. Press Sync on Grace.
