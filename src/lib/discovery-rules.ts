// Personalization questions the company's own receptionist asks after booking a demo (pure; unit
// tested). Research writes questions for each researched account; callers we haven't researched
// get the set for their type of business. Answers go into the prospect's demo agent.

export const MAX_DISCOVERY_QUESTIONS = 5;

export type DiscoveryTrade = "mechanics" | "contractors" | "retail" | "general";

export const TRADE_QUESTIONS: Record<DiscoveryTrade, string[]> = {
  mechanics: [
    "What kinds of repairs and maintenance do you do most, and is there anything you don't work on, like certain makes, diesel or EVs?",
    "How do customers usually book: drop-off times, waiting appointments, or both?",
    "What should the receptionist say when someone asks for a price over the phone?",
    "Do you offer anything callers often ask about, like a shuttle, loaner cars, a warranty on repairs or financing?",
    "When a parts supplier or another shop calls, who should those calls go to?",
  ],
  contractors: [
    "What services do you offer, and what jobs do you turn down?",
    "Which towns or areas do you cover?",
    "Do you do free estimates, and how should a site visit be booked?",
    "Do you take emergency or after-hours calls, and if so, what counts as an emergency?",
    "What should the receptionist say when someone asks for a price over the phone?",
  ],
  retail: [
    "What do people call about most: stock, hours, returns, or something else?",
    "Do you take appointments or bookings, and for what?",
    "What's your return or exchange policy?",
    "Do you offer delivery, pickup or special orders?",
    "When a supplier or delivery driver calls, who should those calls go to?",
  ],
  general: [
    "What are the main services or products customers call you about?",
    "What should the receptionist book for callers, and how long does that usually take?",
    "What should the receptionist say when someone asks for a price over the phone?",
    "What questions do callers ask you most often?",
    "Which calls should always come straight to you instead of the receptionist?",
  ],
};

/** The question set for a business type as the CRM or the caller describes it. */
export function tradeFor(industry: string | null | undefined): DiscoveryTrade {
  const s = (industry ?? "").toLowerCase();
  if (/auto|mechanic|car |cars|vehicle|tire|tyre|brake|collision|body shop|transmission|oil change|garage/.test(s)) return "mechanics";
  if (/plumb|electric|hvac|heating|roof|contract|construct|renovat|landscap|paint|drywall|carpent|floor|concrete|handyman|gutter|fenc|septic|pest|cleaning|trade/.test(s)) return "contractors";
  if (/retail|store|shop|boutique|salon|spa|barber|florist|bakery|café|cafe|restaurant|pharmacy|clinic|studio/.test(s)) return "retail";
  return "general";
}

/** Research's questions, kept short and de-duplicated; anything unusable is dropped. */
export function cleanQuestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of raw) {
    if (typeof q !== "string") continue;
    const text = q.replace(/\s+/g, " ").trim();
    const key = text.toLowerCase().replace(/[?.!\s]+$/, "");
    if (text.length < 8 || text.length > 300 || seen.has(key)) continue;
    seen.add(key);
    out.push(/[?.]$/.test(text) ? text : `${text}?`);
    if (out.length === MAX_DISCOVERY_QUESTIONS) break;
  }
  return out;
}

/** The questions for one caller: their account's researched questions, else their trade's set. */
export function pickDiscoveryQuestions(account: { discoveryQuestions?: string | null; industry?: string | null } | null, businessType?: string | null): { source: "research" | "trade"; trade: DiscoveryTrade; questions: string[] } {
  let researched: string[] = [];
  try {
    researched = cleanQuestions(JSON.parse(account?.discoveryQuestions || "[]"));
  } catch {
    researched = [];
  }
  const trade = tradeFor(account?.industry || businessType);
  if (researched.length) return { source: "research", trade, questions: researched };
  return { source: "trade", trade, questions: TRADE_QUESTIONS[trade].slice(0, MAX_DISCOVERY_QUESTIONS) };
}

export type QA = { question: string; answer: string };

/**
 * The agent sends answers as "Question: answer" lines (or "Q: …" / "A: …" pairs). Unanswered or
 * skipped questions are dropped.
 */
export function parseAnswers(text: string): QA[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim().replace(/^[-*•\d.)\s]+/, "")).filter(Boolean);
  const out: QA[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const q = line.match(/^q(?:uestion)?\s*[:\-]\s*(.+)$/i);
    if (q) {
      const a = lines[i + 1]?.match(/^a(?:nswer)?\s*[:\-]\s*(.+)$/i);
      if (a) {
        out.push({ question: q[1]!.trim(), answer: a[1]!.trim() });
        i++;
      }
      continue;
    }
    // "Question? answer" or "Question: answer" on one line.
    const split = line.match(/^(.+?\?)\s*[:\-–]?\s*(.+)$/) ?? line.match(/^(.+?):\s+(.+)$/);
    if (split) out.push({ question: split[1]!.trim(), answer: split[2]!.trim() });
  }
  const skipped = /^(skip(ped)?|n\/?a|none|no answer|not sure|don'?t know|unknown|-+)\.?$/i;
  return out.filter((qa) => qa.answer && !skipped.test(qa.answer)).slice(0, 20);
}

/** The knowledge-base entry built from the caller's answers. */
export function answersToKnowledge(answers: QA[], callerName: string | null, date: Date): { title: string; content: string } {
  const day = date.toISOString().slice(0, 10);
  return {
    title: `From the owner (call on ${day})`,
    content: [
      `What ${callerName?.trim() || "the owner"} told us on the phone when booking their demo. Use it to answer callers.`,
      "",
      ...answers.flatMap((qa) => [`Q: ${qa.question}`, `A: ${qa.answer}`, ""]),
    ].join("\n").trim(),
  };
}
