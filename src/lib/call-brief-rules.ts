// The call brief (pure; unit tested): what the dialer shows while a number is ringing or live —
// who, which company, why they'd want an AI receptionist, and the notes that matter. Short enough
// to read at a glance on a phone.

export type CallBrief = {
  person: string | null; // who you're likely talking to
  company: string;
  about: string | null; // industry · city
  website: string | null;
  why: string[]; // why they'd need a receptionist
  notes: string[]; // the account notes and recent notes, trimmed
  opener: string | null;
  facts: string[];
  last: string | null; // last touch
};

const TRADE_WHY: { test: RegExp; lines: string[] }[] = [
  { test: /auto|mechanic|tire|collision|garage/i, lines: ["Techs are under cars, so calls ring out during the day", "After-hours breakdown and booking calls go to voicemail"] },
  { test: /plumb|electric|hvac|heating|roof|contract|renovat|landscap|paint|construct|trade/i, lines: ["On job sites all day: calls go unanswered while they work", "Emergency and after-hours calls go to the next contractor on Google"] },
  { test: /mortgage|broker|insurance|realt|accountant|bookkeep|financial|advis|lawyer|notary/i, lines: ["In client meetings: new-client calls go to voicemail", "Prospects call the next broker who answers"] },
  { test: /retail|store|shop|salon|spa|barber|boutique|studio/i, lines: ["Staff serving customers in person can't take every call", "Evening and weekend calls about hours and bookings go unanswered"] },
];

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/** Why this business would want an AI receptionist: research first, then the numbers, then the trade. */
export function whyReceptionist(o: { painSignals?: string[]; industry?: string | null; missedPerWeek?: number | null; avgJobValueCents?: number | null }): string[] {
  const out: string[] = [];
  for (const p of o.painSignals ?? []) if (p && p.trim()) out.push(p.trim());
  if (o.missedPerWeek && o.missedPerWeek > 0) {
    const atRisk = o.avgJobValueCents ? ` (about ${money(o.missedPerWeek * 4 * o.avgJobValueCents * 0.3)}/month in lost jobs if 30% would have booked)` : "";
    out.push(`About ${o.missedPerWeek} missed calls a week${atRisk}`);
  }
  if (out.length < 3) {
    const trade = TRADE_WHY.find((t) => t.test.test(o.industry ?? ""));
    for (const l of trade?.lines ?? ["Calls they miss while busy or after hours go to competitors"]) if (out.length < 3) out.push(l);
  }
  return out.slice(0, 4);
}

/** Notes worth reading before they pick up: the account notes (first lines) and the latest note entries. */
export function briefNotes(accountNotes: string, recentNotes: (string | null)[]): string[] {
  const lines = accountNotes
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(source|tags?):/i.test(l))
    .slice(0, 4);
  for (const n of recentNotes) {
    const t = (n ?? "").replace(/\s+/g, " ").trim();
    if (t && !lines.includes(t)) lines.push(t);
    if (lines.length >= 6) break;
  }
  return lines.map((l) => (l.length > 220 ? `${l.slice(0, 217)}…` : l));
}
