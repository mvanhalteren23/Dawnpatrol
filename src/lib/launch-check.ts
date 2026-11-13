import "server-only";
import { db } from "./db";
import { getSetting } from "./settings";
import { PRICES } from "./site-content";
import { creditState, moneyState, type CheckState } from "./launch-check-rules";

// CRM → Launch check: what's ready and what still needs doing before taking paying clients.
// Live checks ask each service directly; the "your side" items are ticked off by hand.

export type Check = { area: string; label: string; state: CheckState; detail: string; fix?: string };

/** Things only the owner can do or confirm (paperwork, other dashboards). Ticked by hand. */
export const MANUAL_ITEMS: { key: string; area: string; label: string; help: string }[] = [
  { key: "dba", area: "Business", label: "\"Head Above Digital\" registered as a business name of Luna VR Inc.", help: "BC Registries → file a DBA / business name for the corporation." },
  { key: "gst", area: "Business", label: "GST/HST number confirmed and added to Stripe invoices", help: "CRA Business Number with an RT account; add it in Stripe → Settings → Business → Tax details." },
  { key: "bank", area: "Business", label: "Business bank account connected to Stripe for payouts", help: "Stripe → Settings → Payouts." },
  { key: "insurance", area: "Business", label: "Insurance in place (general liability, errors & omissions, cyber)", help: "A broker can quote a tech-services package; ask for E&O and cyber." },
  { key: "lawyer", area: "Business", label: "Client agreement and website terms reviewed by a BC lawyer", help: "Especially fees, cancellation, liability cap and the caller-recording wording." },
  { key: "accountant", area: "Business", label: "Accountant confirmed sales tax (GST/HST, and whether BC PST applies)", help: "The CRM charges GST/HST by province; PST isn't added." },
  { key: "stripe_terms", area: "Payments", label: "Terms of Service link added in Stripe", help: "Stripe → Settings → Business → Public details → Terms of service URL: https://www.headabovedigital.com/terms. Needed for the \"I agree\" tick box at checkout." },
  { key: "stripe_webhook", area: "Payments", label: "Stripe webhook points at this site (live mode)", help: "Stripe → Developers → Webhooks → endpoint /api/webhooks/stripe, with its signing secret saved in Vercel as STRIPE_WEBHOOK_SECRET." },
  { key: "vercel_pro", area: "Hosting", label: "Vercel upgraded to Pro, with a spending cap", help: "The free plan doesn't allow commercial use. Vercel → Settings → Billing." },
  { key: "backup_secrets", area: "Hosting", label: "Nightly database backup is running", help: "GitHub → Actions → Database backup should show green runs each night." },
  { key: "twilio_recharge", area: "Phones", label: "Twilio auto-recharge switched on", help: "Twilio Console → Billing → auto-recharge (e.g. add $20 when the balance drops below $10), so lines never stop for lack of funds." },
  { key: "elevenlabs_billing", area: "Phones", label: "ElevenLabs plan sized for client minutes, with usage-based billing on", help: "elevenlabs.io → Subscription. When credits run out, calls connect and then drop." },
  { key: "gemini_paid", area: "AI", label: "Gemini API key is on the paid tier", help: "The privacy policy says prompts aren't used to improve Google's products, which is only true on the paid tier." },
  { key: "google_verify", area: "Google", label: "Google has approved the calendar app", help: "docs/google-calendar-verification.md: record the video and submit. Until then clients use the built-in calendar, which works without it." },
  { key: "first_call", area: "Phones", label: "Test call to the main line passed today (Grace answers, books, sends the text)", help: "Call the main number from a phone that isn't on the team list." },
];

const doneKey = (key: string) => `launch.done.${key}`;

export async function manualDone(): Promise<Set<string>> {
  const rows = await db.setting.findMany({ where: { key: { startsWith: "launch.done." } } });
  return new Set(rows.filter((r) => r.value === "yes").map((r) => r.key.slice("launch.done.".length)));
}

export async function setManualDone(key: string, done: boolean) {
  if (!MANUAL_ITEMS.some((m) => m.key === key)) return;
  const { setSetting } = await import("./settings");
  await setSetting(doneKey(key), done ? "yes" : "");
}

const short = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 160);

async function elevenLabs(): Promise<Check> {
  const base = { area: "Phones", label: "ElevenLabs (the voice that answers)" };
  if (!process.env.ELEVENLABS_API_KEY) return { ...base, state: "todo", detail: "No API key set.", fix: "Add ELEVENLABS_API_KEY in Vercel." };
  try {
    const { el } = await import("./elevenlabs");
    const s = await el<{ tier?: string; status?: string; character_count?: number; character_limit?: number; next_character_count_reset_unix?: number }>("/v1/user/subscription");
    const used = s.character_count ?? 0;
    const limit = s.character_limit ?? 0;
    const state = s.status && s.status !== "active" && s.status !== "trialing" ? "todo" : creditState(used, limit);
    const reset = s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString().slice(0, 10) : null;
    return {
      ...base,
      state,
      detail: `${s.tier ?? "Unknown"} plan, ${s.status ?? "status unknown"}: ${used.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} credits used${reset ? `, resets ${reset}` : ""}.`,
      fix: state === "ok" ? undefined : "Credits are (nearly) used up: calls connect and then drop. Upgrade the plan or turn on usage-based billing at elevenlabs.io → Subscription.",
    };
  } catch (e) {
    return { ...base, state: "unknown", detail: `Couldn't read the subscription (${short(e)}).`, fix: "Check credits at elevenlabs.io → Subscription. If the key is restricted, allow it to read the user." };
  }
}

async function twilio(): Promise<Check> {
  const base = { area: "Phones", label: "Twilio balance (numbers, calls, texts)" };
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return { ...base, state: "todo", detail: "Twilio isn't configured.", fix: "Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Vercel." };
  try {
    const { twilioApi } = await import("./twilio");
    const b = await twilioApi<{ balance: string; currency: string }>("/Balance.json");
    const amount = Number(b.balance);
    const state = moneyState(amount, 10);
    return { ...base, state, detail: `${b.currency} $${amount.toFixed(2)} left.`, fix: state === "ok" ? undefined : "Add funds and turn on auto-recharge in the Twilio Console → Billing. At zero, lines stop answering." };
  } catch (e) {
    return { ...base, state: "unknown", detail: `Couldn't read the balance (${short(e)}).`, fix: "Check the balance in the Twilio Console." };
  }
}

async function backupAnswer(): Promise<Check> {
  const base = { area: "Phones", label: "Backup answering on every number" };
  try {
    const { fallbackCoverage } = await import("./agent-fallback");
    const c = await fallbackCoverage();
    if (!c.total) return { ...base, state: "unknown", detail: "No numbers on the Twilio account point at this site." };
    return c.missing
      ? { ...base, state: "todo", detail: `${c.missing} of ${c.total} number${c.total === 1 ? "" : "s"} have no backup: if this site were unreachable, callers would hear an error.`, fix: "Press the button to set it on every number." }
      : { ...base, state: "ok", detail: `All ${c.total} number${c.total === 1 ? "" : "s"} take a message if this site can't be reached.` };
  } catch (e) {
    return { ...base, state: "unknown", detail: `Couldn't read the numbers (${short(e)}).` };
  }
}

/**
 * Run from the 30-minute sweep: text and email the team when voice credits or the phone balance
 * are running out, at most once a day each, so lines never stop without warning.
 */
export async function healthAlerts(): Promise<string[]> {
  const { alertOnce } = await import("./agent-fallback");
  const { appUrl } = await import("./app-url");
  const sent: string[] = [];
  for (const [key, c] of [["elevenlabs", await elevenLabs()], ["twilio", await twilio()]] as const) {
    if (c.state !== "todo" && c.state !== "warn") continue;
    const urgent = c.state === "todo";
    if (await alertOnce(`health.${key}.${c.state}`, 24 * 60, `${urgent ? "URGENT: " : ""}${c.label} ${urgent ? "has run out" : "is running low"}`, `${c.detail} ${c.fix ?? ""} ${appUrl()}/crm/launch`)) sent.push(key);
  }
  return sent;
}

async function stripeChecks(): Promise<Check[]> {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key) return [{ area: "Payments", label: "Stripe", state: "todo", detail: "No Stripe key set.", fix: "Add STRIPE_SECRET_KEY (live) in Vercel." }];
  const live = /^(sk|rk)_live_/.test(key);
  const out: Check[] = [
    { area: "Payments", label: "Stripe is in live mode", state: live ? "ok" : "todo", detail: live ? "Live key in use: real cards are charged." : "A test key is in use: no real money moves.", fix: live ? undefined : "Replace STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Vercel with the live ones, then redeploy." },
    { area: "Payments", label: "Stripe webhook secret", state: process.env.STRIPE_WEBHOOK_SECRET ? "ok" : "todo", detail: process.env.STRIPE_WEBHOOK_SECRET ? "Set." : "Missing: payments wouldn't update the CRM.", fix: process.env.STRIPE_WEBHOOK_SECRET ? undefined : "Stripe → Developers → Webhooks → signing secret → STRIPE_WEBHOOK_SECRET in Vercel." },
  ];
  try {
    const Stripe = (await import("stripe")).default;
    const acct = await new Stripe(key).accounts.retrieveCurrent();
    const ready = Boolean(acct.charges_enabled && acct.payouts_enabled);
    out.push({ area: "Payments", label: "Stripe account can take payments and pay out", state: ready ? "ok" : "todo", detail: ready ? `Charges and payouts are enabled${acct.business_profile?.name ? ` for ${acct.business_profile.name}` : ""}.` : `Charges ${acct.charges_enabled ? "on" : "off"}, payouts ${acct.payouts_enabled ? "on" : "off"}.`, fix: ready ? undefined : "Finish Stripe's activation (business details, bank account, identity)." });
  } catch (e) {
    out.push({ area: "Payments", label: "Stripe account can take payments and pay out", state: "unknown", detail: `Couldn't read the account (${short(e)}).`, fix: "Check Stripe → Settings → Business that activation is complete." });
  }
  return out;
}

export async function launchChecks(): Promise<Check[]> {
  const [el, tw, backup, st, plans, admins, spend, house, connectLive, testers, address, inboxes, google, clientsWithLogin] = await Promise.all([
    elevenLabs(),
    twilio(),
    backupAnswer(),
    stripeChecks(),
    db.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } }),
    db.user.findMany({ where: { role: "ADMIN", disabled: false }, select: { email: true, phone: true, totpEnabledAt: true } }),
    getSetting("twilio.spendAlert"),
    (await import("./house-line")).houseReceptionist(),
    getSetting("calendar.connectLive"),
    getSetting("calendar.connectTesters"),
    getSetting("campaign.address"),
    db.outreachInbox.count(),
    (await import("./google")).googleConnection().catch(() => ({ connected: false, email: null })),
    db.user.findUnique({ where: { email: (process.env.ADMIN_EMAIL ?? "").toLowerCase() || "-" }, select: { role: true } }),
  ]);
  const checks: Check[] = [el, tw, backup];

  checks.push(
    !process.env.TWILIO_DEMO_NUMBER
      ? { area: "Phones", label: "Main line", state: "todo", detail: "No main number set.", fix: "Set TWILIO_DEMO_NUMBER in Vercel." }
      : !house
        ? { area: "Phones", label: "Main line", state: "todo", detail: "No company receptionist found.", fix: "Create the company receptionist (CRM → Receptionists)." }
        : house.guardTrippedAt
          ? { area: "Phones", label: "Main line", state: "todo", detail: `${house.name}'s line is paused by call protection: callers get voicemail.`, fix: `Open ${house.name} in CRM → Receptionists and reset the protection.` }
          : house.syncStatus !== "SYNCED"
            ? { area: "Phones", label: "Main line", state: "warn", detail: `${house.name} has changes that aren't synced to ElevenLabs (${house.syncStatus.toLowerCase()}).`, fix: `Open ${house.name} and press Sync.` }
            : { area: "Phones", label: "Main line", state: "ok", detail: `${house.name} answers the main number and is synced.` },
  );
  checks.push({ area: "Phones", label: "Daily Twilio spending alert", state: Number(spend) > 0 ? "ok" : "todo", detail: Number(spend) > 0 ? `Alerts at US$${spend} a day.` : "Not set.", fix: Number(spend) > 0 ? undefined : "CRM → Settings → Call protection: set an amount (e.g. 25) and Save." });
  const withPhone = admins.filter((a) => a.phone);
  checks.push({ area: "Phones", label: "Your mobile on your login", state: withPhone.length ? "ok" : "todo", detail: withPhone.length ? "Set: alerts reach you by text and the line recognises you." : "No administrator has a mobile set.", fix: withPhone.length ? undefined : "CRM → Settings → Users → your login → mobile." });

  checks.push(...st);
  const main = plans.find((p) => p.kind === "plan" && p.priceCents === PRICES.CAD.monthly * 100);
  checks.push({ area: "Payments", label: `The CA$${PRICES.CAD.monthly} plan`, state: main ? "ok" : "todo", detail: main ? `"${main.name}" is active. Its Stripe prices (CAD and USD) are created automatically the first time you make a checkout link.` : "No active plan at the website's price.", fix: main ? undefined : "CRM → Billing: add or fix the plan." });
  const stale = plans.filter((p) => p.kind === "plan" && p.id !== main?.id);
  if (stale.length) checks.push({ area: "Payments", label: "Old plans still on offer", state: "warn", detail: `${stale.map((p) => `${p.name} ($${(p.priceCents / 100).toFixed(0)})`).join(", ")} can still be picked when creating a checkout link.`, fix: "Hide them below so only the current plan is offered." });

  checks.push({ area: "Google", label: "Company Google account (Drive, email, calendar)", state: google.connected ? "ok" : "todo", detail: google.connected ? `Connected as ${google.email}.` : "Not connected.", fix: google.connected ? undefined : "CRM → Settings → Connect Google." });
  const calKeys = Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET);
  checks.push({
    area: "Google",
    label: "Clients' own Google Calendar",
    state: !calKeys ? "warn" : connectLive === "on" ? "warn" : "ok",
    detail: !calKeys ? "Calendar app keys aren't set; clients use the built-in calendar (works without Google)." : connectLive === "on" ? "Offered to every client now. Until Google approves the app, they'd see an \"unverified app\" warning." : `Hidden until approval${testers ? ` (test clients: ${testers})` : ""}; clients use the built-in calendar.`,
    fix: calKeys && connectLive === "on" ? "If Google hasn't approved yet: CRM → Settings → Client calendars, untick the box and list your test client instead." : undefined,
  });

  checks.push({ area: "AI", label: "Claude and Gemini keys", state: process.env.ANTHROPIC_API_KEY && process.env.GEMINI_API_KEY ? "ok" : process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY ? "warn" : "todo", detail: `Claude ${process.env.ANTHROPIC_API_KEY ? "set" : "missing"}, Gemini ${process.env.GEMINI_API_KEY ? "set" : "missing"}.` });

  const noTwoStep = admins.filter((a) => !a.totpEnabledAt);
  checks.push({ area: "Security", label: "Two-step sign-in on administrator logins", state: noTwoStep.length ? "todo" : "ok", detail: noTwoStep.length ? `Off for ${noTwoStep.map((a) => a.email).join(", ")}.` : "On for every administrator.", fix: noTwoStep.length ? "CRM → Settings → Two-step sign-in (2 minutes with an authenticator app)." : undefined });
  if (clientsWithLogin && clientsWithLogin.role !== "ADMIN") checks.push({ area: "Security", label: "ADMIN_EMAIL setting", state: "warn", detail: "It's set to an address that's now a client login.", fix: "In Vercel, change ADMIN_EMAIL to your administrator address." });

  checks.push({ area: "Cold email", label: "Campaigns (optional for launch)", state: address && inboxes ? "ok" : "warn", detail: `${inboxes} sending inbox${inboxes === 1 ? "" : "es"} connected; mailing address ${address ? "set" : "not set"}.`, fix: address && inboxes ? undefined : "CRM → Email campaigns: connect a warmed-up inbox and enter your mailing address before the first campaign." });
  return checks;
}
