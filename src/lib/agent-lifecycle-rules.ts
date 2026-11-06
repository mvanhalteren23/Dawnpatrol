// Demo vs production agents, pure parts (unit tested). Demos are deleted from ElevenLabs after
// DEMO_IDLE_DAYS without calls or changes, unless the deal is still moving; the CRM keeps their
// settings and knowledge so a demo can be revived. Signed clients get a fresh production agent
// copied from their demo ("Promote to production").

export const DEMO_IDLE_DAYS = 30;

/** Deal stages where a prospect's demo is kept however long it sits unused. */
export const KEEP_DEMO_STAGES = ["ENGAGED", "DEMO", "PROPOSAL", "ONBOARDING"];

export type DemoActivity = { lifecycle: string; createdAt: Date; updatedAt: Date; lastCallAt: Date | null; accountStage: string; promoted: boolean };

export function lastActive(d: Pick<DemoActivity, "createdAt" | "updatedAt" | "lastCallAt">): Date {
  return new Date(Math.max(d.createdAt.getTime(), d.updatedAt.getTime(), d.lastCallAt?.getTime() ?? 0));
}

/** When the demo will expire if nothing happens (null: it won't, or isn't a demo). */
export function demoExpiresAt(d: DemoActivity, days = DEMO_IDLE_DAYS): Date | null {
  if (d.lifecycle !== "demo") return null;
  // Once promoted, the deal stage no longer protects the demo: the client has their own agent.
  if (!d.promoted && KEEP_DEMO_STAGES.includes(d.accountStage)) return null;
  return new Date(lastActive(d).getTime() + days * 86400_000);
}

export function shouldExpire(d: DemoActivity, now = new Date(), days = DEMO_IDLE_DAYS): boolean {
  const at = demoExpiresAt(d, days);
  return Boolean(at && at.getTime() <= now.getTime());
}

/** Settings a production agent takes over from the demo (not its line, calendar or demo extension). */
export const PROMOTE_FIELDS = [
  "name", "greeting", "persona", "voiceId", "language", "timezone", "businessHours", "escalationPhone", "escalationRules",
  "bookingUrl", "extraInstructions", "bookingSlotMinutes", "bookingHours", "bookingMinNoticeHours", "bookingDaysAhead",
  "bookingBufferMinutes", "bookingMeetingType", "bookingQuestions", "bookingHolidays", "bookingClosedDates", "followUpOn", "followUpChannel",
  "brandLogoUrl", "brandColor", "emailSignOff", "emailReplyTo",
] as const;

export function promotedSettings<T extends Record<(typeof PROMOTE_FIELDS)[number], unknown>>(demo: T): Pick<T, (typeof PROMOTE_FIELDS)[number]> {
  return Object.fromEntries(PROMOTE_FIELDS.map((f) => [f, demo[f]])) as Pick<T, (typeof PROMOTE_FIELDS)[number]>;
}

export type PortalAgent = { agentType: string; lifecycle: string };

/** The receptionist a client's portal shows: their production inbound agent, else any inbound one. */
export function pickPortalReceptionist<T extends PortalAgent>(rs: T[]): T | null {
  const inbound = rs.filter((r) => r.agentType === "inbound");
  return inbound.find((r) => r.lifecycle === "production") ?? inbound.find((r) => r.lifecycle === "demo") ?? inbound[0] ?? rs.find((r) => r.agentType !== "followup" && r.agentType !== "builder") ?? null;
}
