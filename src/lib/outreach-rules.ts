// Pure rules for automatic outreach tracking (unit tested).
import { FOLLOW_UP_DAYS } from "./constants";
import { addDays, normalizeDomain } from "./utils";

const TOUCH_TYPES = new Set(["EMAIL", "CALL", "SMS", "LINKEDIN", "MEETING"]);

/** Stage auto-advance: first outbound touch → CONTACTED, first inbound reply → ENGAGED. Never moves backwards. */
export function nextStageAfterActivity(stage: string, type: string, direction: string | null): string {
  if (!TOUCH_TYPES.has(type)) return stage;
  if (type === "MEETING" && (stage === "PROSPECT" || stage === "CONTACTED" || stage === "ENGAGED")) return "DEMO";
  if (direction === "OUTBOUND" && stage === "PROSPECT") return "CONTACTED";
  if (direction === "INBOUND" && (stage === "PROSPECT" || stage === "CONTACTED")) return "ENGAGED";
  return stage;
}

/** Follow-up scheduling: outbound with no reply → due in N days; inbound → follow up tomorrow. */
export function nextFollowUp(type: string, direction: string | null, at: Date, isProspect: boolean): Date | null | undefined {
  if (!TOUCH_TYPES.has(type) || !isProspect) return undefined; // leave unchanged
  if (direction === "OUTBOUND") return addDays(at, FOLLOW_UP_DAYS);
  if (direction === "INBOUND") return addDays(at, 1);
  return undefined;
}

export type MatchIndex = {
  byEmail: Map<string, { accountId: string; contactId: string }>;
  byDomain: Map<string, string>; // domain -> accountId
};

export function buildMatchIndex(
  contacts: { id: string; accountId: string; email: string | null }[],
  accounts: { id: string; domain: string | null }[],
): MatchIndex {
  const byEmail = new Map<string, { accountId: string; contactId: string }>();
  for (const c of contacts) if (c.email) byEmail.set(c.email.toLowerCase(), { accountId: c.accountId, contactId: c.id });
  const byDomain = new Map<string, string>();
  for (const a of accounts) if (a.domain) byDomain.set(a.domain, a.id);
  return { byEmail, byDomain };
}

/** Find the CRM account for a set of counterpart addresses: exact contact email first, then company domain. */
export function matchAddresses(addresses: string[], index: MatchIndex): { accountId: string; contactId: string | null } | null {
  for (const a of addresses) {
    const hit = index.byEmail.get(a);
    if (hit) return hit;
  }
  for (const a of addresses) {
    const domain = normalizeDomain(a);
    const accountId = domain ? index.byDomain.get(domain) : undefined;
    if (accountId) return { accountId, contactId: null };
  }
  return null;
}
