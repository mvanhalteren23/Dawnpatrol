import "server-only";
import { db } from "./db";
import { safeJson } from "./utils";
import {
  bestScript, coachMaterial, PRACTICE_SCENARIOS, scriptReviewReady, scriptStats, statsTable,
  type CoachCall, type PracticeKey, type ScriptStat,
} from "./coach-rules";

// The sales coach (rules in coach-rules.ts). Reads the dialer's recorded calls (outcome, summary and
// transcript), compares call scripts on meetings and closed deals, and saves every review so the
// team can come back to it. Practice calls: the coach plays a prospect.

export type CoachScope = { days: number; userId?: string | null; scriptId?: string | null };

/** Dialer calls in a timeframe (newest first), optionally one rep's or one script's. */
export async function coachCalls(scope: CoachScope): Promise<CoachCall[]> {
  const since = new Date(Date.now() - scope.days * 86400_000);
  const rows = await db.activity.findMany({
    where: {
      type: "CALL",
      source: "dialer",
      occurredAt: { gte: since },
      ...(scope.userId ? { createdById: scope.userId } : {}),
      ...(scope.scriptId !== undefined ? { scriptId: scope.scriptId } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: 1000,
    include: { account: { select: { name: true, industry: true } }, createdBy: { select: { name: true, email: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    accountName: r.account.name,
    industry: r.account.industry,
    scriptId: r.scriptId,
    outcome: r.outcome,
    durationSec: r.durationSec,
    occurredAt: r.occurredAt,
    body: r.body,
    rep: r.createdBy ? r.createdBy.name ?? r.createdBy.email.split("@")[0] ?? null : null,
  }));
}

export async function scriptNames(): Promise<Map<string, string>> {
  return new Map((await db.callScript.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]));
}

/** Per-script numbers for a timeframe, with closed deals credited to the last script before signing. */
export async function coachStats(scope: CoachScope): Promise<{ calls: CoachCall[]; stats: ScriptStat[]; best: ScriptStat | null }> {
  const calls = await coachCalls(scope);
  const accountIds = [...new Set(calls.map((c) => c.accountId))];
  const converted = new Map(
    (await db.account.findMany({ where: { id: { in: accountIds }, convertedAt: { not: null } }, select: { id: true, convertedAt: true } })).map((a) => [a.id, a.convertedAt!]),
  );
  const stats = scriptStats(calls, converted);
  return { calls, stats, best: bestScript(stats) };
}

async function save(o: { kind: string; title: string; params: object; createdById: string | null; run: () => Promise<object> }): Promise<string> {
  const review = await db.coachReview.create({ data: { kind: o.kind, title: o.title, params: JSON.stringify(o.params), status: "RUNNING", createdById: o.createdById } });
  try {
    const result = await o.run();
    await db.coachReview.update({ where: { id: review.id }, data: { status: "DONE", result: JSON.stringify(result) } });
  } catch (err) {
    await db.coachReview.update({ where: { id: review.id }, data: { status: "FAILED", error: (err as Error).message.slice(0, 500) } });
  }
  return review.id;
}

const scopeLabel = (s: CoachScope, rep: string | null) => `last ${s.days} days${rep ? `, ${rep}` : ""}`;

/** Call coaching: what worked, what didn't, the best script or approach. */
export async function runCallReview(scope: CoachScope, by: string | null, repName: string | null): Promise<string> {
  return save({
    kind: "calls",
    title: `Call review: ${scopeLabel(scope, repName)}`,
    params: scope,
    createdById: by,
    run: async () => {
      const [{ calls, stats, best }, names] = await Promise.all([coachStats(scope), scriptNames()]);
      const material = coachMaterial(calls, names);
      if (!material) throw new Error("No recorded calls with a transcript in that timeframe yet. Make some dialer calls (they're recorded and transcribed automatically), then try again.");
      const { coachCallReview } = await import("./ai");
      const review = await coachCallReview(material, statsTable(stats, names), scopeLabel(scope, repName));
      return { review, stats, best: best?.scriptId ?? null, calls: calls.length };
    },
  });
}

/** Script lab: after enough calls, how the script is doing and 1-2 new approaches to test. */
export async function runScriptReview(scriptId: string, by: string | null): Promise<string> {
  const script = await db.callScript.findUniqueOrThrow({ where: { id: scriptId } });
  return save({
    kind: "script",
    title: `Script review: ${script.name}`,
    params: { scriptId },
    createdById: by,
    run: async () => {
      const [{ calls, stats }, names] = await Promise.all([coachStats({ days: 365 }), scriptNames()]);
      const mine = calls.filter((c) => c.scriptId === scriptId);
      const ready = scriptReviewReady(mine.length);
      if (!ready.ready) throw new Error(`Make ${ready.remaining} more call${ready.remaining === 1 ? "" : "s"} with this script first.`);
      const { coachNewApproaches } = await import("./ai");
      const res = await coachNewApproaches(script.name, script.body, coachMaterial(mine, names), statsTable(stats, names));
      return { ...res, approaches: res.approaches.slice(0, 2), stats: stats.find((s) => s.scriptId === scriptId) ?? null };
    },
  });
}

/** Coach one recorded call. */
export async function runSingleCallReview(activityId: string, by: string | null): Promise<string> {
  const a = await db.activity.findUniqueOrThrow({ where: { id: activityId }, include: { account: { select: { name: true, industry: true } } } });
  return save({
    kind: "call",
    title: `Call with ${a.account.name}`,
    params: { activityId, accountId: a.accountId },
    createdById: by,
    run: async () => {
      const { callText } = await import("./coach-rules");
      const text = callText(a.body);
      if (!/Transcript:/i.test(a.body ?? "")) throw new Error("This call has no transcript yet (recordings are transcribed a minute or two after the call).");
      const { coachSingleCall } = await import("./ai");
      const names = await scriptNames();
      return coachSingleCall(text, `Business: ${a.account.name}${a.account.industry ? ` (${a.account.industry})` : ""}. Outcome: ${a.outcome ?? "unknown"}. Script: ${a.scriptId ? names.get(a.scriptId) ?? "unknown" : "none"}.`);
    },
  });
}

/** The objection playbook, or the opener comparison, from a timeframe's calls. */
export async function runPatternReview(kind: "objections" | "openers", scope: CoachScope, by: string | null, repName: string | null): Promise<string> {
  return save({
    kind,
    title: `${kind === "objections" ? "Objection playbook" : "Openers"}: ${scopeLabel(scope, repName)}`,
    params: scope,
    createdById: by,
    run: async () => {
      const [{ calls }, names] = await Promise.all([coachStats(scope), scriptNames()]);
      const material = coachMaterial(calls, names);
      if (!material) throw new Error("No recorded calls with a transcript in that timeframe yet.");
      const ai = await import("./ai");
      return kind === "objections" ? ai.coachObjections(material) : ai.coachOpeners(material);
    },
  });
}

// --- Practice calls -------------------------------------------------------------

export type PracticeState = { scenario: PracticeKey; brief: string; messages: { role: "user" | "assistant"; content: string }[]; feedback?: unknown };

export async function startPractice(key: PracticeKey, by: string | null): Promise<string> {
  const sc = PRACTICE_SCENARIOS.find((s) => s.key === key) ?? PRACTICE_SCENARIOS[0];
  const { practiceProspectReply } = await import("./ai");
  // The prospect picks up first.
  const hello = await practiceProspectReply(sc.brief, [{ role: "user", content: "(The phone rings. You answer it.)" }]);
  const state: PracticeState = { scenario: sc.key, brief: sc.brief, messages: [{ role: "assistant", content: hello }] };
  const r = await db.coachReview.create({ data: { kind: "practice", title: `Practice: ${sc.label}`, params: JSON.stringify({ scenario: sc.key }), result: JSON.stringify(state), status: "RUNNING", createdById: by } });
  return r.id;
}

export async function practiceSay(reviewId: string, text: string): Promise<void> {
  const r = await db.coachReview.findUniqueOrThrow({ where: { id: reviewId } });
  if (r.kind !== "practice" || r.status !== "RUNNING") return;
  const state = safeJson<PracticeState>(r.result, { scenario: "busy-plumber", brief: "", messages: [] });
  const said = text.trim().slice(0, 1000);
  if (!said) return;
  // The conversation starts with the prospect answering; the model needs the user's turn first.
  const history = [{ role: "user" as const, content: "(The phone rings. You answer it.)" }, ...state.messages, { role: "user" as const, content: said }];
  const { practiceProspectReply } = await import("./ai");
  const reply = await practiceProspectReply(state.brief, history);
  state.messages.push({ role: "user", content: said }, { role: "assistant", content: reply });
  await db.coachReview.update({ where: { id: r.id }, data: { result: JSON.stringify(state) } });
}

export async function finishPractice(reviewId: string): Promise<void> {
  const r = await db.coachReview.findUniqueOrThrow({ where: { id: reviewId } });
  if (r.kind !== "practice") return;
  const state = safeJson<PracticeState>(r.result, { scenario: "busy-plumber", brief: "", messages: [] });
  const transcript = state.messages.map((m) => `${m.role === "user" ? "Rep" : "Prospect"}: ${m.content}`).join("\n");
  try {
    if (state.messages.filter((m) => m.role === "user").length < 2) throw new Error("Say a bit more before asking for feedback.");
    const { practiceFeedback } = await import("./ai");
    state.feedback = await practiceFeedback(state.brief, transcript);
    await db.coachReview.update({ where: { id: r.id }, data: { status: "DONE", result: JSON.stringify(state) } });
  } catch (err) {
    await db.coachReview.update({ where: { id: r.id }, data: { error: (err as Error).message.slice(0, 300) } });
  }
}
