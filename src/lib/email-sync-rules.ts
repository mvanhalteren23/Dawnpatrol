// Gmail → CRM (pure; unit tested): reading names from headers, which addresses become contacts, and
// the search used to pull an account's past emails when it's created.

import { isSharedMailDomain } from "./campaign-rules";
import { looksLikeInstructions } from "./safety-rules";

export type Address = { name: string; email: string };

/** How far back an account's past emails are searched, and how many are recorded per mailbox. */
export const BACKFILL_YEARS = 2;
export const BACKFILL_MAX_MESSAGES = 200;
/** Live sync while someone uses the CRM: at most this often (the daily cron is the safety net). */
export const LIVE_SYNC_MINUTES = 10;

/** `"Dave Smith" <dave@x.ca>, anna@y.com` → [{ name: "Dave Smith", email: "dave@x.ca" }, { name: "", email: "anna@y.com" }] */
export function parseAddressList(header: string | null | undefined): Address[] {
  if (!header) return [];
  const out: Address[] = [];
  const seen = new Set<string>();
  // Split on commas that aren't inside quotes or angle brackets.
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = false;
  for (const ch of header) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<") angle = true;
    else if (ch === ">") angle = false;
    if (ch === "," && !quoted && !angle) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  for (const raw of parts) {
    const m = raw.match(/[A-Za-z0-9._%+\-']+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
    if (!m) continue;
    const email = m[0].toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const name = raw.includes("<") ? raw.slice(0, raw.indexOf("<")).replace(/["']/g, "").trim() : "";
    out.push({ name: name && !name.includes("@") ? name : "", email });
  }
  return out;
}

/** Mail robots and bulk senders never become contacts. */
export function isAutomatedAddress(email: string): boolean {
  const local = email.split("@")[0] ?? "";
  return /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?|newsletter|news|marketing|automated|system|daemon|unsubscribe)([+._-].*)?$/i.test(local) || /bounce|noreply/i.test(email.split("@")[1] ?? "");
}

/** A person's name from a header, split for the contact; nothing that isn't plainly a name. */
export function splitName(name: string): { firstName: string | null; lastName: string | null } {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 80 || looksLikeInstructions(clean) || /[<>@{}[\]\\/|:;]/.test(clean) || /\d{3,}/.test(clean)) return { firstName: null, lastName: null };
  // "Smith, Dave" → Dave Smith
  const flipped = /^([^,]+),\s*(.+)$/.exec(clean);
  const words = (flipped ? `${flipped[2]} ${flipped[1]}` : clean).split(" ").filter(Boolean);
  return { firstName: words[0]?.slice(0, 40) ?? null, lastName: words.length > 1 ? words.slice(1).join(" ").slice(0, 60) : null };
}

/** The account's own domain, when it's safe to match a whole domain (never gmail.com and the like). */
export function matchableDomain(domain: string | null | undefined): string | null {
  const d = (domain ?? "").toLowerCase().replace(/^@/, "").trim();
  return d && d.includes(".") && !isSharedMailDomain(d) ? d : null;
}

/**
 * The Gmail search for an account's past emails: anything to or from its domain (when it has its own)
 * or its contacts' addresses, in the last BACKFILL_YEARS years. Null when there's nothing to search by.
 */
export function backfillQuery(o: { domain: string | null | undefined; emails: (string | null | undefined)[] }): string | null {
  const terms: string[] = [];
  const domain = matchableDomain(o.domain);
  if (domain) terms.push(`from:${domain}`, `to:${domain}`, `cc:${domain}`);
  for (const e of new Set(o.emails.map((x) => (x ?? "").trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(x)))) {
    if (domain && e.endsWith(`@${domain}`)) continue; // already covered by the domain
    terms.push(`from:${e}`, `to:${e}`);
  }
  if (!terms.length) return null;
  return `{${terms.join(" ")}} newer_than:${BACKFILL_YEARS}y -in:chats`;
}

/**
 * Who should be added as a contact on an account from one email: people at the account's own domain
 * (or the exact addresses already known), not us, not robots, not already contacts.
 */
export function newContactsFrom(
  people: Address[],
  o: { domain: string | null | undefined; me: string; existing: Set<string> },
): Address[] {
  const domain = matchableDomain(o.domain);
  if (!domain) return [];
  return people.filter((p) => p.email !== o.me && p.email.endsWith(`@${domain}`) && !isAutomatedAddress(p.email) && !o.existing.has(p.email));
}
