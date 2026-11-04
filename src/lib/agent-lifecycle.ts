import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { el, syncReceptionist } from "./elevenlabs";
import { recordActivity } from "./outreach";
import { nextFreeExtension } from "./twilio";
import { safeJson } from "./utils";
import { recordKbChange } from "./kb-history";
import { demoExpiresAt, promotedSettings, shouldExpire, type DemoActivity } from "./agent-lifecycle-rules";

// Demo vs production agents (rules in agent-lifecycle-rules.ts): the daily cron expires idle
// demos, an expired demo can be revived, and a signed client's demo is promoted to a fresh
// production agent.

type DemoRow = { id: string; lifecycle: string; createdAt: Date; updatedAt: Date; account: { stage: string } };

async function activityFor(demos: DemoRow[]): Promise<Map<string, DemoActivity>> {
  const ids = demos.map((d) => d.id);
  const [calls, promoted] = await Promise.all([
    db.callLog.groupBy({ by: ["receptionistId"], where: { receptionistId: { in: ids } }, _max: { startedAt: true } }),
    db.receptionist.findMany({ where: { promotedFromId: { in: ids } }, select: { promotedFromId: true } }),
  ]);
  const lastCall = new Map(calls.map((c) => [c.receptionistId, c._max.startedAt]));
  const wasPromoted = new Set(promoted.map((p) => p.promotedFromId));
  return new Map(demos.map((d) => [d.id, { lifecycle: d.lifecycle, createdAt: d.createdAt, updatedAt: d.updatedAt, lastCallAt: lastCall.get(d.id) ?? null, accountStage: d.account.stage, promoted: wasPromoted.has(d.id) }]));
}

/** When each demo will expire if unused (null = kept), for the CRM pages. */
export async function demoExpiry(demos: DemoRow[]): Promise<Map<string, Date | null>> {
  const acts = await activityFor(demos.filter((d) => d.lifecycle === "demo"));
  return new Map(demos.map((d) => [d.id, acts.has(d.id) ? demoExpiresAt(acts.get(d.id)!) : null]));
}

/** Delete the demo's agent, tools and knowledge docs in ElevenLabs; keep its settings and knowledge here. */
export async function expireDemo(id: string, reason: string) {
  const r = await db.receptionist.findUniqueOrThrow({ where: { id } });
  const gone = (e: unknown) => {
    if (!String(e).includes(" 404 ")) console.warn("demo cleanup", id, (e as Error).message);
  };
  if (r.elevenLabsAgentId) await el(`/agents/${r.elevenLabsAgentId}`, { method: "DELETE" }).catch(gone);
  for (const toolId of Object.values(safeJson<Record<string, string>>(r.elevenLabsToolIds, {}))) await el(`/tools/${toolId}`, { method: "DELETE" }).catch(gone);
  for (const doc of safeJson<{ docId: string }[]>(r.elevenLabsKbDocs, [])) await el(`/knowledge-base/${doc.docId}`, { method: "DELETE" }).catch(gone);
  await db.receptionist.update({
    where: { id },
    data: { lifecycle: "expired", expiredAt: new Date(), demoExtension: null, elevenLabsAgentId: null, elevenLabsKbDocs: "[]", elevenLabsToolIds: "{}", syncStatus: "NEVER", syncError: null },
  });
  await recordActivity({ accountId: r.accountId, type: "NOTE", source: "system", subject: `Demo receptionist expired (${r.name})`, body: `${reason} Its settings and knowledge are kept in the CRM: open it and click Revive demo to bring it back.` });
}

/** Daily: expire demos idle for 30 days (unless the deal is still moving). */
export async function expireIdleDemos(now = new Date()): Promise<{ expired: string[]; errors: string[] }> {
  const demos = await db.receptionist.findMany({ where: { lifecycle: "demo" }, select: { id: true, name: true, lifecycle: true, createdAt: true, updatedAt: true, account: { select: { stage: true } } } });
  const acts = await activityFor(demos);
  const expired: string[] = [];
  const errors: string[] = [];
  for (const d of demos) {
    if (!shouldExpire(acts.get(d.id)!, now)) continue;
    try {
      await expireDemo(d.id, "No calls or changes for 30 days.");
      expired.push(d.id);
    } catch (err) {
      errors.push(`${d.id}: ${(err as Error).message}`);
    }
  }
  return { expired, errors };
}

/** Bring an expired demo back: a new extension and a fresh ElevenLabs agent from the kept settings. */
export async function reviveDemo(id: string): Promise<string> {
  const taken = await db.receptionist.findMany({ where: { demoExtension: { not: null } }, select: { demoExtension: true } });
  const ext = nextFreeExtension(taken.map((t) => t.demoExtension));
  await db.receptionist.update({ where: { id }, data: { lifecycle: "demo", expiredAt: null, demoExtension: ext } });
  await syncReceptionist(id);
  return ext;
}

/**
 * A signed client: a new production agent with the demo's settings and knowledge (not its demo
 * extension, calendar or line). The demo stays as it was and expires later. Sync is returned as
 * `background`.
 */
export async function promoteToProduction(demoId: string, by: { id: string; email: string }) {
  const demo = await db.receptionist.findUniqueOrThrow({ where: { id: demoId }, include: { knowledge: true, account: true } });
  if (demo.lifecycle === "production") return { ok: false as const, message: "This is already a production agent." };
  const existing = await db.receptionist.findFirst({ where: { accountId: demo.accountId, lifecycle: "production", agentType: "inbound", bookingAddsToCrm: false } });
  if (existing) return { ok: false as const, message: `${demo.account.name} already has a production receptionist (${existing.name}).`, existingId: existing.id };

  const prod = await db.$transaction(async (tx) => {
    const created = await tx.receptionist.create({
      data: {
        ...promotedSettings(demo),
        accountId: demo.accountId,
        businessName: demo.account.name,
        ragToken: randomBytes(24).toString("base64url"),
        lifecycle: "production",
        promotedFromId: demo.id,
        createdById: by.id,
        bookingTitle: "Appointment",
        // The client's own calendar and line are set up during onboarding.
        bookingEnabled: false,
        googleUserId: null,
      },
    });
    for (const k of demo.knowledge) {
      const item = await tx.knowledgeItem.create({ data: { receptionistId: created.id, category: k.category, title: k.title, content: k.content, tags: k.tags, isActive: k.isActive, updatedBy: by.email } });
      await recordKbChange(tx, { receptionistId: created.id, itemId: item.id, action: "create", before: null, after: item, by: { email: by.email, role: "system" } });
    }
    return created;
  });
  await recordActivity({ accountId: demo.accountId, type: "NOTE", source: "system", subject: `Promoted to production: ${prod.name}`, body: `Copied from the demo receptionist with ${demo.knowledge.length} knowledge items. Next: business line or keep-number, calendar, and the onboarding checklist.`, createdById: by.id });
  return { ok: true as const, id: prod.id, items: demo.knowledge.length, background: () => syncReceptionist(prod.id).then(() => undefined) };
}
