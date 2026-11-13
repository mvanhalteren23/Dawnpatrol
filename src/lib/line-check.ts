import "server-only";
import { db } from "./db";
import { appUrl } from "./app-url";
import { getSetting, setSetting } from "./settings";
import { toE164 } from "./twilio";
import { alertOnce, applyFallbackUrls, crmNumbers, type TwilioNumberRow } from "./agent-fallback";
import { checkDue, evaluateLine, type LineCheckRun, type LineResult } from "./line-check-rules";

// The free daily line check: no test call, so no minutes spent. For every client line (and ours)
// it asks ElevenLabs whether the voice agent still exists and Twilio whether the number still
// points at this site, and sets the backup address where it's missing. Problems text and email the
// team once a day; results show on CRM → Launch check. Runs from the 30-minute sweep.

export const LINE_CHECK_KEY = "linecheck.last";

export async function lastLineCheck(): Promise<LineCheckRun | null> {
  try {
    return JSON.parse((await getSetting(LINE_CHECK_KEY)) ?? "null") as LineCheckRun | null;
  } catch {
    return null;
  }
}

async function agentState(agentId: string): Promise<"ok" | "missing" | "unknown"> {
  try {
    const { el } = await import("./elevenlabs");
    await el(`/agents/${agentId}`);
    return "ok";
  } catch (err) {
    return / 404 /.test(String((err as Error).message)) ? "missing" : "unknown";
  }
}

export async function runLineCheck(): Promise<LineCheckRun> {
  const base = appUrl().replace(/\/$/, "");
  const lines = await db.receptionist.findMany({
    where: { agentType: "inbound", OR: [{ lifecycle: "production" }, { bookingAddsToCrm: true }] },
    select: { id: true, name: true, businessName: true, elevenLabsAgentId: true, syncStatus: true, guardTrippedAt: true, businessNumber: true, bookingAddsToCrm: true },
    orderBy: { createdAt: "asc" },
  });

  // Twilio's numbers: set the backup address where it's missing (idempotent), then read them for the check.
  let healed = 0;
  let numbers: TwilioNumberRow[] | null = null;
  try {
    healed = await applyFallbackUrls();
    numbers = await crmNumbers();
  } catch (err) {
    console.warn("line check: couldn't read Twilio numbers", err);
  }
  const byNumber = new Map((numbers ?? []).map((n) => [toE164(n.phone_number), n]));

  const results: LineResult[] = [];
  for (let i = 0; i < lines.length; i += 5) {
    const batch = await Promise.all(lines.slice(i, i + 5).map(async (r) => {
      const agent = r.elevenLabsAgentId ? await agentState(r.elevenLabsAgentId) : "ok";
      const own = r.businessNumber ?? (r.bookingAddsToCrm ? process.env.TWILIO_DEMO_NUMBER ?? null : null);
      const row = own && numbers ? byNumber.get(toE164(own)) : null;
      const findings = evaluateLine({
        hasAgent: Boolean(r.elevenLabsAgentId),
        agent,
        syncStatus: r.syncStatus,
        paused: Boolean(r.guardTrippedAt),
        number: own && numbers ? { found: Boolean(row), answersHere: (row?.voice_url ?? "").startsWith(`${base}/api/voice/`), hasBackup: row?.voice_fallback_url === `${base}/api/voice/fallback` } : null,
      });
      return { id: r.id, name: r.name, business: r.businessName, ...findings } satisfies LineResult;
    }));
    results.push(...batch);
  }

  const run: LineCheckRun = { at: new Date().toISOString(), lines: results, healed };
  await setSetting(LINE_CHECK_KEY, JSON.stringify(run));

  const bad = results.filter((l) => l.problems.length);
  if (bad.length) {
    await alertOnce("linecheck.daily", 20 * 60, `Daily line check: ${bad.length} line${bad.length === 1 ? "" : "s"} need${bad.length === 1 ? "s" : ""} attention`, `${bad.slice(0, 6).map((l) => `${l.business}: ${l.problems[0]}`).join("\n")}${bad.length > 6 ? `\n…and ${bad.length - 6} more` : ""}\n${base}/crm/launch`);
  }
  return run;
}

/** Once a day, from the 30-minute sweep. */
export async function runLineCheckIfDue(): Promise<LineCheckRun | null> {
  const last = await lastLineCheck();
  return checkDue(last?.at) ? runLineCheck() : null;
}
