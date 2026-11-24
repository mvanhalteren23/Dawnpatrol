// The receptionist's caller routing and the Assistant tier: pure rules, unit tested. No imports.
//
// Every receptionist (base plan): urgent calls, as the owner defines them, are put through to the
// transfer number; suppliers and deliveries (from a list the owner uploads, or spotted on calls
// and confirmed on a check-in call) are put through or left as a message, as the owner chooses.
//
// The Assistant tier is IN DEVELOPMENT: off in production (assistantTierLive) until it launches.
//
// On top of the receptionist, an Assistant line:
//   - learns who's who: callers who aren't customers (suppliers, sales reps, sub-trades, staff,
//     family) are listed for the owner in one evening text; their reply ("1S 2V") files them,
//   - routes them by the owner's rules: put through to a number, take a message, or treat as normal,
//   - lets the owner change it by phone or text, with a keypad PIN for bigger changes (permanent
//     hours, prices, services, policies, routing),
//   - calls the owner when open questions pile up (owner-checkin.ts), including callers still unlabelled.
// Which lines have it: assistantEntitled() below.

// --- Entitlement -----------------------------------------------------------------------------

export const ASSISTANT_TIER = "assistant";

/** The Assistant Plan bundle: Voice Agent + Follow-Up Agent + the assistant features. Not on the website. */
export const ASSISTANT_PLAN = {
  name: "Assistant Plan",
  CAD: 238,
  USD: 185,
  includedMinutes: 300,
  features: [
    "Everything in the Voice Agent plan",
    "Follow-Up Agent included: website leads called back within minutes",
    "Learns your suppliers, sales reps, sub-trades and staff from a nightly text, and routes them your way",
    "Puts the right callers straight through to you (or whoever you choose)",
    "Change hours, prices, services and routing by calling or texting your line; bigger changes need your PIN",
    "Calls you when callers' questions pile up, so your receptionist keeps learning",
  ].join("\n"),
};

const PAID = ["ACTIVE", "TRIALING", "PAST_DUE"];

/**
 * Is the Assistant tier switched on in this environment? Off in production unless ASSISTANT_TIER=on;
 * on in previews and local development unless ASSISTANT_TIER=off.
 */
export function assistantTierLive(env: { VERCEL_ENV?: string; ASSISTANT_TIER?: string } = process.env): boolean {
  if (env.ASSISTANT_TIER === "on") return true;
  if (env.ASSISTANT_TIER === "off") return false;
  return env.VERCEL_ENV !== "production";
}

export type EntitlementInput = {
  tierLive: boolean; // assistantTierLive()
  lifecycle: string; // production | demo | expired
  assistantOverride: string; // "" (follow the plan) | "on" | "off"
  planTier: string | null; // the account's plan tier, if it has one
  subscriptionStatus: string | null;
};

/**
 * Does this line get the Assistant features? Never while the tier is in development (not live
 * here). Then the team's override wins; demos always do (so prospects can hear it); otherwise the
 * account must be on an Assistant-tier plan that is paid up (or trialing, or in the past-due grace
 * period). Our own line (Grace) is a receptionist: its admins get owner controls separately.
 */
export function assistantEntitled(o: EntitlementInput): boolean {
  if (!o.tierLive) return false;
  if (o.assistantOverride === "on") return true;
  if (o.assistantOverride === "off") return false;
  if (o.lifecycle === "demo") return true;
  return o.planTier === ASSISTANT_TIER && PAID.includes(o.subscriptionStatus ?? "");
}

// --- Caller categories -----------------------------------------------------------------------

export const CATEGORIES = ["SUPPLIER", "VENDOR", "SUBTRADE", "STAFF", "PERSONAL", "CUSTOMER", "SPAM"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  SUPPLIER: "Supplier / delivery",
  VENDOR: "Sales rep / vendor",
  SUBTRADE: "Sub-trade / partner",
  STAFF: "Staff",
  PERSONAL: "Personal / family",
  CUSTOMER: "Customer",
  SPAM: "Spam",
};

/** Letters for the evening text. D = don't know / skip it. */
export const DIGEST_LETTERS: Record<string, Category | "DISMISS"> = { S: "SUPPLIER", V: "VENDOR", T: "SUBTRADE", E: "STAFF", P: "PERSONAL", C: "CUSTOMER", X: "SPAM", D: "DISMISS" };

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

/** The agent's post-call "caller_kind" field (lower case) as a category guess; null = nothing to ask. */
export function suggestedCategory(kind: unknown): Category | "" | null {
  const k = typeof kind === "string" ? kind.trim().toLowerCase() : "";
  const map: Record<string, Category | ""> = { supplier: "SUPPLIER", vendor: "VENDOR", subtrade: "SUBTRADE", staff: "STAFF", personal: "PERSONAL", unknown: "" };
  return k in map ? map[k]! : null; // customer, spam and blank: don't ask the owner
}

/** A check-in answer ("they're our lumber supplier", "sales guy", "my wife") as a category. */
export function categoryFromAnswer(answer: string): Category | null {
  const a = ` ${answer.toLowerCase()} `;
  const rules: [RegExp, Category][] = [
    [/\b(spam|scam|robo ?call|telemarket|junk|block (it|them))\b/, "SPAM"],
    [/\b(sub[- ]?trades?|sub[- ]?contractors?|subs|partner|electrician|plumber|framer|roofer|inspector)\b/, "SUBTRADE"],
    [/\b(sales ?(rep|guy|gal|person|call)?|vendor|rep\b|selling|marketing|advertis|seo|solicit)/, "VENDOR"],
    [/\b(suppl(y|ier|iers)|parts|deliver(y|ies)|courier|lumber|wholesale|distributor|yard)\b/, "SUPPLIER"],
    [/\b(staff|employee|crew|works? (for|with) (me|us)|my (tech|guy|apprentice|manager|bookkeeper))\b/, "STAFF"],
    [/\b(wife|husband|partner at home|mom|mum|dad|son|daughter|brother|sister|family|friend|personal)\b/, "PERSONAL"],
    [/\b(customer|client|regular|homeowner)\b/, "CUSTOMER"],
  ];
  for (const [re, c] of rules) if (re.test(a)) return c;
  return null;
}

// --- Routing ---------------------------------------------------------------------------------

export const ROUTE_ACTIONS = ["transfer", "message", "normal", "end"] as const;
export type RouteAction = (typeof ROUTE_ACTIONS)[number];
export type RoutingRule = { action: RouteAction; to?: string | null };
export type RoutingRules = Partial<Record<Category, RoutingRule>>;

export const ROUTE_LABELS: Record<RouteAction, string> = {
  transfer: "Put them through",
  message: "Take a message",
  normal: "Handle like any caller",
  end: "Politely end the call",
};

/** Sensible defaults: people who keep the business running get through; sales reps leave a message. */
export function defaultRules(): Required<Pick<RoutingRules, Category>> {
  return {
    SUPPLIER: { action: "transfer" },
    SUBTRADE: { action: "transfer" },
    STAFF: { action: "transfer" },
    PERSONAL: { action: "transfer" },
    VENDOR: { action: "message" },
    CUSTOMER: { action: "normal" },
    SPAM: { action: "end" },
  };
}

const E164 = /^\+[1-9]\d{9,14}$/;

/** Stored JSON → rules, with defaults filled in and anything malformed dropped. */
export function parseRoutingRules(json: string | null | undefined): Required<Pick<RoutingRules, Category>> {
  const out = defaultRules();
  let raw: unknown = {};
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    return out;
  }
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isCategory(k) || !v || typeof v !== "object") continue;
    const { action, to } = v as { action?: unknown; to?: unknown };
    if (typeof action !== "string" || !(ROUTE_ACTIONS as readonly string[]).includes(action)) continue;
    out[k] = { action: action as RouteAction, to: typeof to === "string" && E164.test(to) ? to : null };
  }
  return out;
}

export type KnownCallerLike = { category: string | null; routeAction: string; routeTo: string | null; name: string; company: string; status: string };

/**
 * Where a call from this caller goes. A caller's own setting wins over their category's rule.
 * `fallbackTo` is the owner's number (ring-first cell, then the transfer number). No number = a
 * transfer becomes a message, never a dead end.
 */
export function routeFor(caller: KnownCallerLike | null, rules: Required<Pick<RoutingRules, Category>>, fallbackTo: string | null): { action: RouteAction; to: string | null } {
  if (!caller || caller.status !== "LABELLED" || !isCategory(caller.category)) return { action: "normal", to: null };
  const own = (ROUTE_ACTIONS as readonly string[]).includes(caller.routeAction) ? { action: caller.routeAction as RouteAction, to: caller.routeTo } : null;
  const rule = own ?? rules[caller.category];
  if (rule.action !== "transfer") return { action: rule.action, to: null };
  const to = (rule.to && E164.test(rule.to) ? rule.to : null) ?? (fallbackTo && E164.test(fallbackTo) ? fallbackTo : null);
  return to ? { action: "transfer", to } : { action: "message", to: null };
}

/** A name or company safe to put in a prompt: plain characters only, short, and never an instruction. */
export function cleanLabel(raw: string | null | undefined): string {
  const t = (raw ?? "").replace(/[^\p{L}\p{N} &'’.,-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  if (/\b(ignore|instruction|prompt|system|assistant|you must|disregard|pretend)\b/i.test(t)) return "";
  return t;
}

/**
 * {{caller_routing}} for the agent: facts and the owner's rule, set by the phone system from the
 * caller's number. Empty for unknown numbers and customers.
 */
export function routingContext(caller: KnownCallerLike | null, route: { action: RouteAction; to: string | null }): string {
  if (!caller || caller.status !== "LABELLED" || !isCategory(caller.category) || caller.category === "CUSTOMER") return "";
  const who = [cleanLabel(caller.name), cleanLabel(caller.company)].filter(Boolean).join(" from ");
  const kind = CATEGORY_LABELS[caller.category].toLowerCase();
  const head = `Known ${kind}${who ? `: ${who}` : ""} (matched from their number; only a hint).`;
  const what =
    route.action === "transfer" ? "The owner wants these calls put through: confirm who it is, say you'll put them through, then call transfer_call."
    : route.action === "message" ? "The owner wants a message taken: get what it's about and any callback details. Don't book them as a customer or put them through."
    : route.action === "end" ? "The owner doesn't want these calls: say the business isn't interested, thank them, and end the call politely."
    : "Handle them like any caller.";
  return `${head} ${what}`;
}

/**
 * Where transfer_call sends a live call: the caller's route, or for an urgent caller the line's
 * transfer number. Null = no transfer is set up (take a message).
 */
export function transferTarget(o: { route: { action: RouteAction; to: string | null }; urgent: boolean; escalationPhone: string | null }): string | null {
  if (o.route.action === "transfer" && o.route.to) return o.route.to;
  if (o.urgent && o.escalationPhone && E164.test(o.escalationPhone)) return o.escalationPhone;
  return null;
}

/** Find the caller the owner means ("Acme Lumber", "Dave", "604 555 0101") among the line's known callers. */
export function matchKnownCaller<T extends { phone: string; name: string; company: string }>(who: string, list: T[]): T | null {
  const digits = who.replace(/\D/g, "");
  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    const hit = list.find((c) => c.phone.replace(/\D/g, "").endsWith(last10));
    if (hit) return hit;
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(the|inc|ltd|llc|co|company|from)\b/g, " ").replace(/\s+/g, " ").trim();
  const w = norm(who);
  if (w.length < 3) return null;
  const scored = list
    .map((c) => {
      const company = norm(c.company);
      const name = norm(c.name);
      const score = company && (w.includes(company) || company.includes(w)) ? 2 : name && (w.includes(name) || name.split(" ")[0] === w.split(" ")[0]) ? 1 : 0;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  // Two equally good matches: ambiguous, so ask rather than guess.
  if (!scored.length || (scored[1] && scored[1].score === scored[0]!.score)) return null;
  return scored[0]!.c;
}

// --- The evening digest ----------------------------------------------------------------------

export const DIGEST_MAX = 9; // single digits keep the reply easy to type
export const DIGEST_HOUR = 17; // 5pm their time, or the first sweep after it
export const DIGEST_LAST_HOUR = 21;
export const PENDING_TO_CHECKIN_HOURS = 48;

/** Is it time for today's digest? Once a day, from 5pm until 9pm their time. */
export function digestDue(localHour: number, today: string, lastSentDate: string | null): boolean {
  return localHour >= DIGEST_HOUR && localHour < DIGEST_LAST_HOUR && lastSentDate !== today;
}

export type DigestItem = { name: string; company: string; phone: string; note: string; suggested: string };

/** "604-555-0101" for the text (North American numbers), otherwise as stored. */
export function prettyPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : e164;
}

export function digestText(o: { businessName: string; items: DigestItem[] }): string {
  const lines = o.items.slice(0, DIGEST_MAX).map((it, i) => {
    const who = [cleanLabel(it.name), cleanLabel(it.company)].filter(Boolean).join(", ") || "Unknown caller";
    const note = it.note ? ` – ${it.note.replace(/\s+/g, " ").slice(0, 70)}` : "";
    const guess = isCategory(it.suggested) ? ` (looks like: ${CATEGORY_LABELS[it.suggested].toLowerCase()})` : "";
    return `${i + 1}) ${who}, ${prettyPhone(it.phone)}${note}${guess}`;
  });
  return [
    `${o.businessName}: who were these callers? Reply with number + letter, e.g. "1S 2V".`,
    ...lines,
    "S=supplier V=sales rep T=sub-trade E=staff P=personal C=customer X=spam D=skip",
    "Reply ALL to accept the guesses.",
  ].join("\n");
}

export type DigestReply = { labels: { n: number; label: Category | "DISMISS" }[]; acceptGuesses: boolean };

/**
 * The owner's reply to a digest, or null if it isn't one (so it's handled as a normal owner text).
 * Accepts "1S 2V", "1s,2v", "1 S; 2 V", "ALL", "all 3X". ("OK" and "1" alone already mean "lead
 * handled" on the owner's line, so they're never used here.)
 */
export function parseDigestReply(body: string, count: number): DigestReply | null {
  const t = body.trim().toUpperCase().replace(/[.!]+$/, "");
  if (!t) return null;
  const acceptGuesses = /^ALL\b/.test(t);
  const rest = acceptGuesses ? t.slice(3) : t;
  if (!rest.trim()) return acceptGuesses ? { labels: [], acceptGuesses } : null;
  // The whole message must be number+letter pairs: anything else is a normal owner text.
  if (!/^[\s,;]*(\d\s*[A-Z][\s,;]*)+$/.test(rest)) return null;
  const labels: DigestReply["labels"] = [];
  for (const m of rest.matchAll(/(\d)\s*([A-Z])/g)) {
    const n = Number(m[1]);
    const label = DIGEST_LETTERS[m[2]!];
    if (!label || n < 1 || n > count) return null; // a letter or number we don't know: not a digest reply
    labels.push({ n, label });
  }
  return labels.length || acceptGuesses ? { labels, acceptGuesses } : null;
}

/** The question for the owner's check-in call about a caller still unlabelled after the digest. */
export function labelQuestion(it: { name: string; company: string; phone: string }): string {
  const who = [cleanLabel(it.name), cleanLabel(it.company)].filter(Boolean).join(" from ");
  return `Who is ${who ? `${who}, ` : ""}calling from ${prettyPhone(it.phone)}: a supplier, a sales rep, a sub-trade, staff, family, or a customer?`;
}

// --- Owner PIN and bigger changes ------------------------------------------------------------

export const PIN_MAX_FAILS = 3;
export const PIN_LOCK_MINUTES = 15;
export const PIN_OK_MINUTES = 10; // a verified PIN covers changes on that call for this long
export const CONFIRM_MINUTES = 10; // a change waiting for YES or a PIN by text

/** 4 to 8 digits, not all the same digit, not a straight run (1234, 9876). Returns a problem or null. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,8}$/.test(pin)) return "Use 4 to 8 digits";
  if (/^(\d)\1+$/.test(pin)) return "Don't use the same digit over and over";
  const d = pin.split("").map(Number);
  const steps = d.slice(1).map((x, i) => x - d[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return "Don't use a straight run like 1234";
  return null;
}

/** Digits pressed on the keypad, however the agent passed them ("1 2 3 4", "1234#"). */
export function keypadDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 12);
}

export function pinLocked(lockedUntil: Date | null, now: Date): boolean {
  return Boolean(lockedUntil && lockedUntil.getTime() > now.getTime());
}

/** After a wrong PIN: the new fail count, and a lock once it reaches the limit. */
export function afterWrongPin(fails: number, now: Date): { fails: number; lockedUntil: Date | null } {
  const n = fails + 1;
  return n >= PIN_MAX_FAILS ? { fails: 0, lockedUntil: new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000) } : { fails: n, lockedUntil: null };
}

/**
 * Owner calls can contain a PIN keyed in on the keypad: runs of 4 or more digits in the owner's
 * own turns are masked before the transcript is stored. (Phone numbers the owner says are masked
 * too; a small price for never keeping a PIN.)
 */
export function redactOwnerDigits(transcript: string): string {
  return transcript
    .split("\n")
    // Stored transcripts label turns "Receptionist:" and "Caller:" (calls.ts); only the caller's are masked.
    .map((line) => (/^(caller|user)\s*:/i.test(line.trim()) ? line.replace(/\d(?:[\s-]?\d){3,}/g, "••••") : line))
    .join("\n");
}

export const MAJOR_INFO = ["PRICING", "SERVICE", "POLICY"];

/**
 * Bigger changes need the owner's PIN (or a YES by text when no PIN is set): permanent hours,
 * prices, services, policies, who gets put through, and feedback on how calls are handled. Closures, blocks, special hours and
 * general notes don't.
 */
export function needsPin(p: { action: string; infoCategory?: string | null }): boolean {
  // Feedback changes how every caller is handled, so it counts as a bigger change too.
  if (p.action === "hours" || p.action === "routing" || p.action === "feedback") return true;
  return p.action === "info" && MAJOR_INFO.includes(p.infoCategory ?? "");
}

export function isYes(body: string): boolean {
  // Not "ok": on the owner's line that already means "lead handled" (follow-up-rules.ts).
  return /^\s*(yes|y|yep|yeah|confirm(ed)?|go ahead|do it)\s*[.!]?\s*$/i.test(body);
}

// --- Feedback ("coaching") -------------------------------------------------------------------
// The owner tells their assistant how to handle calls ("don't ask for an email so early", "be
// shorter with sales reps"). Each piece of feedback becomes one short rule; the agent follows them
// unless they clash with its core rules, the knowledge base or a tool's instructions.

export const COACHING_MAX_RULES = 20;
export const COACHING_MAX_CHARS = 240;

/** Why a rule can't be used (a sentence for the owner), or null if it's fine. */
export function coachingProblem(rule: string): string | null {
  const r = rule.trim();
  if (!r) return "What should I do differently?";
  if (r.length > COACHING_MAX_CHARS) return "That's a lot for one rule. Could you say it more briefly?";
  const lower = r.toLowerCase();
  const refused: [RegExp, string][] = [
    [/\b(say|tell (them|callers|people)|claim|pretend)\b[^.]{0,40}\b(human|real person|not (an? )?(ai|robot|bot))\b/, "I always have to say I'm an AI assistant if someone asks."],
    [/\b(ask|collect|take|get|request|record|write down|note)\b[^.]{0,40}\b(card|credit card|debit|bank|banking|sin|social insurance|social security|password)\b/, "I can't take payment, banking, ID or password details on calls."],
    [/\b(ignore|disregard|forget|override|turn off)\b[^.]{0,30}\b(instructions?|rules?|prompt|guidelines|safety)\b/, "I can't switch off my own rules."],
    [/\b(reveal|share|read out|tell)\b[^.]{0,30}\b(system prompt|instructions|your prompt)\b/, "I can't share my instructions."],
  ];
  for (const [re, why] of refused) {
    const m = re.exec(lower);
    // "Never ask for card numbers" is fine: only the instruction to do it is refused.
    if (m && !/\b(never|don'?t|do not|avoid|stop|no longer|not)\b[^.]*$/.test(lower.slice(0, m.index))) return why;
  }
  return null;
}

export function coachingRules(stored: string | null | undefined): string[] {
  return (stored ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, COACHING_MAX_RULES);
}

/** Add a rule (no exact repeats). Full: the oldest rule makes room, and is returned so the owner hears about it. */
export function addCoachingRule(stored: string, rule: string): { value: string; dropped: string | null } {
  const rules = coachingRules(stored);
  const clean = rule.replace(/\s+/g, " ").trim();
  if (rules.some((r) => r.toLowerCase() === clean.toLowerCase())) return { value: rules.join("\n"), dropped: null };
  rules.push(clean);
  const dropped = rules.length > COACHING_MAX_RULES ? rules.shift()! : null;
  return { value: rules.join("\n"), dropped };
}

export function removeCoachingRule(stored: string, index: number): string {
  return coachingRules(stored).filter((_, i) => i !== index).join("\n");
}

/** The prompt section with the owner's rules (empty when there are none). */
export function coachingSection(stored: string | null | undefined, businessName: string): string {
  const rules = coachingRules(stored);
  if (!rules.length) return "";
  return `
Feedback from the owner of ${businessName} on how to handle calls (follow it, unless it clashes with your core rules above, the knowledge base's facts or a tool's instructions; those always win):
${rules.map((r) => `- ${r}`).join("\n")}
`;
}

// --- Suppliers and deliveries (every receptionist) --------------------------------------------

/** The kinds of caller a receptionist without the Assistant tier routes: suppliers and deliveries. */
export const BASE_CATEGORIES: readonly Category[] = ["SUPPLIER"];

export type SupplierRow = { name: string; company: string; phone: string };

/**
 * A pasted or uploaded supplier list: one per line, with a phone number and any of a contact name
 * and company, in any order, separated by commas or tabs ("Acme Lumber, Dave, 604-555-0101"). A
 * header row and lines without a 10-digit number are skipped and reported.
 */
export function parseSupplierList(text: string): { rows: SupplierRow[]; skipped: string[] } {
  const rows: SupplierRow[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let first = true;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const isFirst = first;
    first = false;
    const m = /(\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/.exec(line);
    if (!m) {
      // Only the first line can be a header row ("Company, Contact, Phone").
      if (!(isFirst && /\b(name|company|phone|number)\b/i.test(line))) skipped.push(line.slice(0, 60));
      continue;
    }
    const phone = `+1${m[2]}${m[3]}${m[4]}`;
    if (seen.has(phone)) continue;
    seen.add(phone);
    const rest = (line.slice(0, m.index) + " " + line.slice(m.index + m[0].length))
      .split(/[,\t;|]/)
      .map((x) => cleanLabel(x.replace(/["']/g, "")))
      .filter(Boolean);
    // Two pieces: "Company, Contact" (a company is usually listed first). One piece: the company.
    const company = rest[0] ?? "";
    const name = rest[1] ?? "";
    rows.push({ name, company, phone });
  }
  return { rows, skipped };
}

/** The check-in question about a caller who sounded like a supplier or delivery. */
export function supplierQuestion(it: { name: string; company: string; phone: string }): string {
  const who = [cleanLabel(it.name), cleanLabel(it.company)].filter(Boolean).join(" from ");
  return `Is ${who || "the caller"} (${prettyPhone(it.phone)}) one of your suppliers or a delivery company? If so, their calls will be handled your way from now on.`;
}

/** The owner's answer to a supplier question: yes (add them), no (don't), or unclear. */
export function supplierAnswer(answer: string): "yes" | "no" | null {
  const a = answer.trim().toLowerCase();
  if (/^(no|nope|nah|not|they're not|they are not|no they|never heard)\b/.test(a) || /\b(not (a |one of )?(our |my )?suppliers?|a customer|spam|sales)\b/.test(a)) return "no";
  if (/^(yes|yeah|yep|yup|correct|they are|that's right|sure)\b/.test(a) || categoryFromAnswer(a) === "SUPPLIER") return "yes";
  return null;
}
