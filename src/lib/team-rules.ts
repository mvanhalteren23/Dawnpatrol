// Pure team/ownership rules (no DB), shared by server code and tests.

export const ROLES = ["ADMIN", "REP", "CLIENT"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  REP: "Sales rep",
  CLIENT: "Client (portal only)",
};

/** Admins and reps use the CRM; clients only the portal. */
export function isStaff(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "REP";
}

/** Can this person work (call, email, edit) an account? Admins: any. Reps: their own or unassigned. */
export function canTouch(session: { sub: string; role: string }, ownerId: string | null | undefined): boolean {
  if (session.role === "ADMIN") return true;
  if (session.role !== "REP") return false;
  return !ownerId || ownerId === session.sub;
}

/** Last 10 digits of a phone number (North American match key), or null. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Business name for duplicate matching: lowercase letters/digits, without Inc/Ltd/LLC/Co/The. */
export function accountKeyName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\b(inc|ltd|llc|corp|co|limited|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Stage probabilities for the weighted forecast (chance the account becomes a paying client).
export const STAGE_PROBABILITY: Record<string, number> = {
  PROSPECT: 0.02,
  CONTACTED: 0.05,
  ENGAGED: 0.15,
  DEMO: 0.35,
  PROPOSAL: 0.6,
  ONBOARDING: 0.9,
};

/** Weighted monthly recurring revenue expected from open pipeline. */
export function weightedForecastCents(accounts: { stage: string }[], expectedMrrCents: number): number {
  return Math.round(accounts.reduce((sum, a) => sum + (STAGE_PROBABILITY[a.stage] ?? 0) * expectedMrrCents, 0));
}
