# Prospect pack format (`headabove.prospects.v1`)

One JSON object. Use `null` for anything unknown; never invent a value to fill a field.

```json
{
  "format": "headabove.prospects.v1",
  "criteria": "auto repair shops in North Vancouver, BC",
  "prospects": [
    {
      "name": "Lonsdale Auto Care",
      "website": "https://lonsdaleautocare.example",
      "phone": "604-555-0123",
      "industry": "Auto repair",
      "address": "123 E 3rd St, North Vancouver, BC V7L 1E5",
      "city": "North Vancouver",
      "state": "BC",
      "employees": 6,
      "hours": "Mon-Fri 8am-5pm, closed weekends",
      "googleRating": 4.6,
      "reviewCount": 212,
      "fitScore": 78,
      "whyFit": "Two-bay owner-run shop, closed weekends, and three reviews mention calls going to voicemail.",
      "sourceUrl": "https://maps.google.com/?cid=...",
      "contacts": [
        { "name": "Dave Singh", "title": "Owner", "email": null, "phone": null, "linkedin": null }
      ],
      "research": {
        "match": "confirmed",
        "report": "Match: confirmed\n\n## Profile\n- Website: https://lonsdaleautocare.example ([source](https://lonsdaleautocare.example))\n- Phone: 604-555-0123 ([source](https://...))\n...\n\n## Pain signals\n- \"Called three times, always voicemail\" (Google review, Mar 2026) ([source](https://...))\n\n## Decision makers\n- Dave Singh, Owner ([source](https://lonsdaleautocare.example/about))",
        "keyFacts": ["Family-owned since 2009", "Specialises in Japanese imports", "Closed weekends"],
        "painSignals": ["3 Google reviews mention voicemail or no call back", "Owner works the bays himself"],
        "estMissedCallsPerWeek": null,
        "avgJobValue": null,
        "suggestedOpener": "Saw a few of your reviews mention calls going to voicemail while you're under a car. That's exactly what we fix.",
        "discoveryQuestions": [
          "Do you work on European cars, or only Japanese and domestic?",
          "Can customers book a time on the phone, or do they just drop the car off?",
          "Do you give rough prices on the phone for common jobs like brakes?",
          "Do you offer a warranty on parts and labour?",
          "Should calls from parts suppliers come straight to you?"
        ]
      }
    }
  ]
}
```

## Fields

| Field | Notes |
|---|---|
| `name` | Required. The business's trading name. |
| `website` | Its own site (not a directory page), or null. |
| `phone` | Main business number as published. |
| `industry` | Plain words, e.g. "Auto repair", "Plumbing", "Mortgage broker". |
| `address`, `city`, `state` | `state` is the province or state code, e.g. "BC". |
| `employees` | Number, only if a source states it. |
| `hours`, `googleRating`, `reviewCount` | As found, or null. |
| `fitScore` | 0-100 (see SKILL.md). |
| `whyFit` | 1-2 sentences. |
| `sourceUrl` | The main listing you found them on. |
| `contacts` | Decision makers named on a source. Each email or phone must be published exactly as given. Up to 5. |
| `research.match` | `"confirmed"`, or `"not_confirmed"` if you couldn't be sure it's the right business (the CRM then fills in nothing from the research and flags it for review). |
| `research.report` | Markdown write-up. **Every phone number, website, email and person's name you put in the fields above must appear in this text**, because the CRM drops any detail the write-up doesn't contain. Put a source link next to each fact. |
| `research.keyFacts` | 3-6 short facts. |
| `research.painSignals` | Evidence that calls or leads are missed. |
| `research.estMissedCallsPerWeek`, `research.avgJobValue` | Numbers (job value in dollars), only with specific evidence; otherwise null. |
| `research.suggestedOpener` | One sentence. |
| `research.discoveryQuestions` | Up to 5 questions for the owner. |

A prospect without `research` is still added (name, phone, website, notes) but gets no research
record.
