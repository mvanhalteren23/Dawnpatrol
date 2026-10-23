import "server-only";
import { db } from "./db";
import { elevenLabsConfigured, getConversation, listConversations } from "./elevenlabs";
import { saveCallLog } from "./call-store";
import { getSetting, setSetting } from "./settings";
import type { PostCallData } from "./calls";

const FIRST_SYNC_DAYS = 30;
const OVERLAP_SECS = 6 * 60 * 60; // re-check recent hours in case a call was still processing last time

/**
 * Pull finished calls straight from ElevenLabs into CallLog. This makes call logging independent of
 * the post-call webhook: if the webhook is missing, misconfigured or a delivery fails, the next sync
 * still picks the call up. Safe to run repeatedly (CallLog.externalId is unique).
 */
export async function syncCalls(opts: { receptionistId?: string } = {}): Promise<{ checked: number; added: number; errors: string[] }> {
  const result = { checked: 0, added: 0, errors: [] as string[] };
  if (!elevenLabsConfigured()) return result;

  const receptionists = await db.receptionist.findMany({
    where: { elevenLabsAgentId: { not: null }, ...(opts.receptionistId ? { id: opts.receptionistId } : {}) },
    select: { id: true, demoExtension: true, elevenLabsAgentId: true },
  });

  for (const r of receptionists) {
    try {
      const latest = await db.callLog.findFirst({ where: { receptionistId: r.id }, orderBy: { startedAt: "desc" }, select: { startedAt: true } });
      const after = latest
        ? Math.floor(latest.startedAt.getTime() / 1000) - OVERLAP_SECS
        : Math.floor(Date.now() / 1000) - FIRST_SYNC_DAYS * 86400;
      const convs = await listConversations(r.elevenLabsAgentId!, after);
      const ids = convs.filter((c) => !c.status || c.status === "done").map((c) => c.conversation_id);
      result.checked += ids.length;
      if (!ids.length) continue;

      const known = new Set(
        (await db.callLog.findMany({ where: { externalId: { in: ids } }, select: { externalId: true } })).map((c) => c.externalId),
      );
      for (const id of ids) {
        if (known.has(id)) continue;
        const data = await getConversation<PostCallData>(id);
        const saved = await saveCallLog(r, { ...data, conversation_id: id });
        if (saved) result.added++;
      }
    } catch (err) {
      console.warn("call sync failed", r.id, err);
      result.errors.push(`${r.id}: ${(err as Error).message.slice(0, 200)}`);
    }
  }
  return result;
}

/** Page-load sync, at most once a minute per receptionist, never blocking the page for long. */
export async function syncCallsThrottled(receptionistId: string, minIntervalMs = 60_000): Promise<void> {
  const key = `calls.lastSync.${receptionistId}`;
  try {
    const last = Number((await getSetting(key)) ?? 0);
    if (Date.now() - last < minIntervalMs) return;
    await setSetting(key, String(Date.now()));
    await Promise.race([syncCalls({ receptionistId }), new Promise((resolve) => setTimeout(resolve, 8000))]);
  } catch (err) {
    console.warn("throttled call sync failed", err);
  }
}

/** Dashboard sync across every receptionist, at most once a minute. */
export async function syncAllCallsThrottled(minIntervalMs = 60_000): Promise<void> {
  const key = "calls.lastSync.all";
  try {
    const last = Number((await getSetting(key)) ?? 0);
    if (Date.now() - last < minIntervalMs) return;
    await setSetting(key, String(Date.now()));
    await Promise.race([syncCalls(), new Promise((resolve) => setTimeout(resolve, 8000))]);
  } catch (err) {
    console.warn("dashboard call sync failed", err);
  }
}
