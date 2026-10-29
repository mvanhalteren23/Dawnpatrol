"use server";
import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { canAccessAudit } from "@/lib/access";
import { canTouch } from "@/lib/team-rules";
import { localDate, parseWeeklyHours, zonedTime } from "@/lib/booking";
import { dialableNumber } from "@/lib/twilio";
import { optInt, str } from "@/lib/utils";
import { planAuditCalls, scenariosFor, seededRandom, SHOP_DEFAULTS } from "@/lib/audit-rules";
import { parseReport, processAudits, startAuditCall, writeReport } from "@/lib/call-audit";

function back(path: string, params?: Record<string, string>): never {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  revalidatePath(path);
  redirect(`${path}${qs}`);
}

async function guardAudit(id: string) {
  const session = await requireStaff();
  if (!(await canAccessAudit(session, id))) back("/crm/audits", { error: "Not your audit" });
  return session;
}

const share = (form: FormData, key: string, fallback: number) => {
  const n = optInt(form, key);
  return n == null ? fallback : Math.min(100, Math.max(0, n)) / 100;
};

function assumptionsFromForm(form: FormData, industry: string) {
  const d = SHOP_DEFAULTS[industry === "auto_repair" ? "auto_repair" : "other"];
  const job = Number(str(form, "avgJobValue").replace(/[$,\s]/g, ""));
  return {
    callsPerWeek: Math.min(2000, Math.max(1, optInt(form, "callsPerWeek") ?? d.callsPerWeek)),
    avgJobValueCents: Number.isFinite(job) && job > 0 ? Math.round(job * 100) : d.avgJobValueCents,
    afterHoursShare: share(form, "afterHoursPct", d.afterHoursShare),
    newCustomerShare: share(form, "newCustomerPct", d.newCustomerShare),
    bookingRate: share(form, "bookingPct", d.bookingRate),
  };
}

/** Set up a one-week call audit: plan the calls and start the schedule. */
export async function createAudit(form: FormData) {
  const session = await requireStaff();
  const accountId = str(form, "accountId");
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) back("/crm/audits", { error: "Pick an account" });
  const path = `/crm/audits/new?account=${accountId}`;
  if (!canTouch(session, account.ownerId)) back(path, { error: "Only the account's owner or an admin can set up its audit" });
  const target = dialableNumber(str(form, "targetNumber"));
  if (!target) back(path, { error: "Enter the business's Canadian or US phone number, with area code" });
  if (form.get("consent") !== "on" || !str(form, "consentName")) back(path, { error: "Record who at the business agreed to the audit" });
  const shopHours = str(form, "shopHours") || "Mon-Fri 08:00-17:30";
  try {
    parseWeeklyHours(shopHours);
  } catch (err) {
    back(path, { error: `Shop hours: ${(err as Error).message}` });
  }
  const timezone = str(form, "timezone") || "America/Vancouver";
  const industry = str(form, "industry") === "other" ? "other" : "auto_repair";
  const customScenarios = str(form, "customScenarios").slice(0, 3000);
  const callsPerDay = Math.min(5, Math.max(1, optInt(form, "callsPerDay") ?? 3));
  const afterHoursCalls = Math.min(7, Math.max(0, optInt(form, "afterHoursCalls") ?? 3));

  // Start on the chosen local date (default tomorrow), for 7 days.
  const startText = str(form, "startDate");
  const tomorrow = localDate(new Date(Date.now() + 86_400_000), timezone);
  const [y, m, d] = /^\d{4}-\d{2}-\d{2}$/.test(startText) ? startText.split("-").map(Number) as [number, number, number] : [tomorrow.y, tomorrow.m, tomorrow.d];
  const startsAt = zonedTime(y, m, d, 0, timezone);
  const endsAt = zonedTime(y, m, d + 7, 0, timezone);

  const seed = randomBytes(8).toString("hex");
  const rnd = seededRandom(seed);
  const keys = scenariosFor(industry, customScenarios).map((s) => s.key);
  const custom = keys.filter((k) => k.startsWith("custom_"));
  const rest = keys.filter((k) => !k.startsWith("custom_")).sort(() => rnd() - 0.5);
  const plan = planAuditCalls({ seed, start: startsAt, days: 7, tz: timezone, shopHours, callsPerDay, afterHoursCalls, scenarioKeys: [...custom, ...rest] });
  if (!plan.length) back(path, { error: "No calls could be planned: check the shop hours and start date" });

  const audit = await db.callAudit.create({
    data: {
      accountId,
      status: "RUNNING",
      targetNumber: target,
      businessName: str(form, "businessName") || account.name,
      industry,
      timezone,
      shopHours,
      callsPerDay,
      afterHoursCalls,
      customScenarios,
      callerIds: str(form, "callerIds").slice(0, 500),
      ownerConsent: `${str(form, "consentName").slice(0, 120)} agreed on ${new Date().toISOString().slice(0, 10)} (recorded by ${session.email})`,
      ...assumptionsFromForm(form, industry),
      startsAt,
      endsAt,
      shareToken: randomBytes(18).toString("base64url"),
      createdById: session.sub,
      calls: { create: plan.map((p) => ({ scheduledAt: p.scheduledAt, window: p.window, afterHours: p.afterHours, scenarioKey: p.scenarioKey, callerName: p.callerName })) },
    },
  });
  back(`/crm/audits/${audit.id}`, { notice: `Audit set up: ${plan.length} calls over 7 days. Place a test call to your own phone first.` });
}

/** Call one of the team with the test caller, to hear it before the business does. */
export async function testAuditCall(id: string, form: FormData) {
  await guardAudit(id);
  const path = `/crm/audits/${id}`;
  const to = dialableNumber(str(form, "phone"));
  if (!to) back(path, { error: "Enter your cell number" });
  const audit = await db.callAudit.findUniqueOrThrow({ where: { id } });
  const keys = scenariosFor(audit.industry, audit.customScenarios).map((s) => s.key);
  const key = keys.includes(str(form, "scenario")) ? str(form, "scenario") : keys[0]!;
  const call = await db.auditCall.create({ data: { auditId: id, scheduledAt: new Date(), window: "Test call", scenarioKey: key, callerName: "Sam", toNumber: to } });
  await startAuditCall(call.id);
  back(path, { notice: `Calling ${to}. Answer as the business would. The transcript appears here a few minutes after you hang up.` });
}

export async function cancelAudit(id: string) {
  await guardAudit(id);
  await db.auditCall.updateMany({ where: { auditId: id, status: "PLANNED" }, data: { status: "SKIPPED", note: "Audit cancelled" } });
  await db.callAudit.update({ where: { id }, data: { status: "CANCELLED" } });
  back(`/crm/audits/${id}`, { notice: "Audit cancelled. No more calls will be placed." });
}

/** Run the schedule now (due calls, transcripts, analysis), e.g. after a test call. */
export async function runAuditNow(id: string) {
  await guardAudit(id);
  after(() => processAudits({ analyzeBudget: 8 }).catch((e) => console.error("audit run", e)));
  back(`/crm/audits/${id}`, { notice: "Checking for due calls and new transcripts. Refresh in a minute." });
}

/** Write the report now with whatever calls are done (ends the audit early if it's still running). */
export async function finishAuditNow(id: string) {
  await guardAudit(id);
  await db.auditCall.updateMany({ where: { auditId: id, status: "PLANNED", toNumber: null }, data: { status: "SKIPPED", note: "Audit ended early" } });
  await db.callAudit.update({ where: { id }, data: { status: "ANALYZING" } });
  after(async () => {
    await processAudits({ analyzeBudget: 25 }).catch((e) => console.error("audit finish", e));
    const a = await db.callAudit.findUnique({ where: { id } });
    if (a?.status === "ANALYZING") await writeReport(id).catch((e: Error) => db.callAudit.update({ where: { id }, data: { error: `Report failed: ${e.message.slice(0, 300)}` } }));
  });
  back(`/crm/audits/${id}`, { notice: "Writing the report. Refresh in a minute or two." });
}

export async function regenerateReport(id: string) {
  await guardAudit(id);
  after(() => writeReport(id).catch((e: Error) => db.callAudit.update({ where: { id }, data: { error: `Report failed: ${e.message.slice(0, 300)}` } })));
  back(`/crm/audits/${id}`, { notice: "Rewriting the report. Refresh in a minute." });
}

export async function saveAuditAssumptions(id: string, form: FormData) {
  await guardAudit(id);
  const audit = await db.callAudit.findUniqueOrThrow({ where: { id } });
  await db.callAudit.update({ where: { id }, data: assumptionsFromForm(form, audit.industry) });
  back(`/crm/audits/${id}`, { notice: "Assumptions saved. The missed-call estimate is updated; rewrite the report to refresh its wording." });
}

/** Purpose 1: turn what staff told callers into knowledge-base drafts for the receptionist (reviewed before use). */
export async function auditFactsToKnowledge(id: string, form: FormData) {
  const session = await guardAudit(id);
  const path = `/crm/audits/${id}`;
  const audit = await db.callAudit.findUniqueOrThrow({ where: { id } });
  const receptionist = await db.receptionist.findFirst({ where: { id: str(form, "receptionistId"), accountId: audit.accountId } });
  if (!receptionist) back(path, { error: "Pick this account's receptionist (create one first)" });
  const facts = parseReport(audit)?.facts ?? [];
  if (!facts.length) back(path, { error: "No facts yet: wait for the report" });
  await db.knowledgeItem.createMany({
    data: facts.map((f) => ({ receptionistId: receptionist.id, category: f.category, title: f.title.slice(0, 200), content: f.content.slice(0, 4000), tags: "call-audit", isActive: false, updatedBy: session.email })),
  });
  back(`/crm/receptionists/${receptionist.id}`, { notice: `${facts.length} facts from the call audit added as drafts. Review and turn on the ones that are right.` });
}
