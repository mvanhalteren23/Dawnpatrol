"use server";
// Sales coach actions (src/lib/coach.ts): scripts, reviews, practice calls.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { str } from "@/lib/utils";
import { looksLikeInstructions } from "@/lib/safety-rules";
import { COACH_TIMEFRAMES, PRACTICE_SCENARIOS, type PracticeKey } from "@/lib/coach-rules";

function back(path: string, params: Record<string, string> = {}): never {
  revalidatePath("/crm/coach");
  const q = new URLSearchParams(params).toString();
  redirect(q ? `${path}${path.includes("?") ? "&" : "?"}${q}` : path);
}

function scopeFrom(form: FormData, me: { sub: string; role: string }) {
  const days = Number(str(form, "days"));
  const rep = str(form, "rep");
  return {
    days: (COACH_TIMEFRAMES as readonly number[]).includes(days) ? days : 14,
    // Reps review their own calls; administrators pick anyone (or everyone).
    userId: me.role === "ADMIN" ? (rep === "all" || !rep ? null : rep) : me.sub,
  };
}

async function repName(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const u = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return u ? u.name ?? u.email.split("@")[0] ?? null : null;
}

// --- Script lab -------------------------------------------------------------------

export async function saveScript(form: FormData) {
  const session = await requireStaff();
  const id = str(form, "id");
  const name = str(form, "name").trim().slice(0, 80);
  const body = str(form, "body").trim().slice(0, 6000);
  const status = ["testing", "active", "retired"].includes(str(form, "status")) ? str(form, "status") : "testing";
  if (!name || !body) back("/crm/coach?tab=scripts", { error: "Give the script a name and the words to say" });
  if (looksLikeInstructions(body) && /ignore (all|previous)/i.test(body)) back("/crm/coach?tab=scripts", { error: "That doesn't look like a call script" });
  if (id) await db.callScript.update({ where: { id }, data: { name, body, status } });
  else await db.callScript.create({ data: { name, body, status, notes: str(form, "notes").slice(0, 500), parentId: str(form, "parentId") || null, createdById: session.sub } });
  back("/crm/coach?tab=scripts", { notice: id ? "Script saved" : `"${name}" added. Pick it in the dialer to start testing it.` });
}

export async function retireScript(id: string) {
  await requireStaff();
  await db.callScript.update({ where: { id }, data: { status: "retired" } });
  back("/crm/coach?tab=scripts", { notice: "Script retired (its calls stay in the numbers)" });
}

/** Save one of the coach's suggested approaches as a new script to test. */
export async function adoptApproach(reviewId: string, index: number) {
  const session = await requireStaff();
  const r = await db.coachReview.findUniqueOrThrow({ where: { id: reviewId } });
  const res = JSON.parse(r.result) as { approaches?: { name: string; idea: string; script: string }[] };
  const params = JSON.parse(r.params) as { scriptId?: string };
  const a = res.approaches?.[index];
  if (!a) back(`/crm/coach/${reviewId}`, { error: "That approach wasn't found" });
  const created = await db.callScript.create({ data: { name: a!.name.slice(0, 80), body: a!.script.slice(0, 6000), status: "testing", notes: `From the coach: ${a!.idea}`.slice(0, 500), parentId: params.scriptId ?? null, createdById: session.sub } });
  back("/crm/coach?tab=scripts", { notice: `"${created.name}" saved to test. Pick it in the dialer.` });
}

// --- Reviews ----------------------------------------------------------------------

export async function reviewCalls(form: FormData) {
  const session = await requireStaff();
  const scope = scopeFrom(form, session);
  const { runCallReview } = await import("@/lib/coach");
  const id = await runCallReview(scope, session.sub, await repName(scope.userId));
  redirect(`/crm/coach/${id}`);
}

export async function reviewScript(scriptId: string) {
  const session = await requireStaff();
  const { runScriptReview } = await import("@/lib/coach");
  const id = await runScriptReview(scriptId, session.sub);
  redirect(`/crm/coach/${id}`);
}

export async function reviewPatterns(kind: "objections" | "openers", form: FormData) {
  const session = await requireStaff();
  const scope = scopeFrom(form, session);
  const { runPatternReview } = await import("@/lib/coach");
  const id = await runPatternReview(kind, scope, session.sub, await repName(scope.userId));
  redirect(`/crm/coach/${id}`);
}

/** "Coach this call" on an account's timeline. */
export async function coachThisCall(activityId: string) {
  const session = await requireStaff();
  const { runSingleCallReview } = await import("@/lib/coach");
  const id = await runSingleCallReview(activityId, session.sub);
  redirect(`/crm/coach/${id}`);
}

// --- Practice calls ---------------------------------------------------------------

export async function startPracticeCall(form: FormData) {
  const session = await requireStaff();
  const key = (PRACTICE_SCENARIOS.find((s) => s.key === str(form, "scenario"))?.key ?? PRACTICE_SCENARIOS[0].key) as PracticeKey;
  const { startPractice } = await import("@/lib/coach");
  const id = await startPractice(key, session.sub);
  redirect(`/crm/coach/${id}`);
}

export async function practiceTurn(reviewId: string, form: FormData) {
  await requireStaff();
  const { practiceSay } = await import("@/lib/coach");
  await practiceSay(reviewId, str(form, "say"));
  redirect(`/crm/coach/${reviewId}#end`);
}

export async function endPractice(reviewId: string) {
  await requireStaff();
  const { finishPractice } = await import("@/lib/coach");
  await finishPractice(reviewId);
  redirect(`/crm/coach/${reviewId}`);
}
