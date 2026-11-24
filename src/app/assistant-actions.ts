"use server";
// Receptionist call routing (urgent calls, suppliers) and Assistant tier settings: shared by the
// CRM and the client portal. Clients manage their own
// line's PIN, routing and caller directory; only the team can switch the tier on or off for a line.
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canAccessReceptionist } from "@/lib/access";
import { str } from "@/lib/utils";
import { CATEGORIES, isCategory, parseRoutingRules, ROUTE_ACTIONS, type RouteAction } from "@/lib/assistant-rules";

async function guard(receptionistId: string) {
  const session = await getSession();
  if (!(await canAccessReceptionist(session, receptionistId))) throw new Error("Not allowed");
  return session!;
}

function done(returnTo: string, message: string, kind: "notice" | "error" = "notice"): never {
  const safe = returnTo.startsWith("/crm/") || returnTo.startsWith("/portal") ? returnTo : "/";
  revalidatePath(safe.split("?")[0]!);
  redirect(`${safe}${safe.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

async function phoneOrNull(raw: string): Promise<string | null | false> {
  if (!raw.trim()) return null;
  const { dialableNumber } = await import("@/lib/twilio");
  return dialableNumber(raw.trim()) ?? false;
}

function resyncLater(receptionistId: string) {
  after(async () => {
    const { markDirty, syncReceptionist } = await import("@/lib/elevenlabs");
    await markDirty(receptionistId);
    await syncReceptionist(receptionistId).catch((e) => console.error("assistant settings sync", e));
  });
}

/** The team only: follow the plan, or force the tier on (comped, manual billing) or off for this line. */
export async function setAssistantOverride(receptionistId: string, returnTo: string, form: FormData) {
  const session = await guard(receptionistId);
  if (session.role === "CLIENT") done(returnTo, "Only the team can change this", "error");
  const v = str(form, "assistantOverride");
  const assistantOverride = v === "on" || v === "off" ? v : "";
  const r = await db.receptionist.update({ where: { id: receptionistId }, data: { assistantOverride } });
  if (r.elevenLabsAgentId) resyncLater(r.id);
  done(returnTo, "Saved. The agent is being updated to match.");
}

/** The owner's keypad PIN for bigger changes by phone or text. */
export async function saveOwnerPin(receptionistId: string, returnTo: string, form: FormData) {
  await guard(receptionistId);
  const pin = str(form, "pin").trim();
  if (pin !== str(form, "pin2").trim()) done(returnTo, "The two PINs don't match", "error");
  const { setOwnerPin } = await import("@/lib/assistant");
  const problem = await setOwnerPin(receptionistId, pin);
  if (problem) done(returnTo, problem, "error");
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, select: { id: true, elevenLabsAgentId: true } });
  if (r.elevenLabsAgentId) resyncLater(r.id); // the agent's instructions mention the PIN step
  done(returnTo, "PIN saved. Bigger changes by phone now need it keyed in on the keypad (or texted back when you text a change).");
}

export async function removeOwnerPin(receptionistId: string, returnTo: string) {
  await guard(receptionistId);
  const { setOwnerPin } = await import("@/lib/assistant");
  await setOwnerPin(receptionistId, null);
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, select: { id: true, elevenLabsAgentId: true } });
  if (r.elevenLabsAgentId) resyncLater(r.id);
  done(returnTo, "PIN removed. Bigger changes are now confirmed by replying YES to a text.");
}

/** How each kind of caller is handled: put through (to the owner or a number), message, normal, end. */
export async function saveRoutingRules(receptionistId: string, returnTo: string, form: FormData) {
  await guard(receptionistId);
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, select: { routingRules: true } });
  const rules = parseRoutingRules(r.routingRules);
  for (const c of CATEGORIES) {
    const action = str(form, `action_${c}`);
    if (!(ROUTE_ACTIONS as readonly string[]).includes(action)) continue;
    const to = action === "transfer" ? await phoneOrNull(str(form, `to_${c}`)) : null;
    if (to === false) done(returnTo, `Enter a 10-digit Canadian or US number for ${c.toLowerCase()} calls, or leave it blank to put them through to you`, "error");
    rules[c] = { action: action as RouteAction, to: to || null };
  }
  await db.receptionist.update({ where: { id: receptionistId }, data: { routingRules: JSON.stringify(rules) } });
  done(returnTo, "Routing saved. It applies from the next call.");
}

/** Add or edit a caller in the directory. */
export async function saveKnownCaller(receptionistId: string, returnTo: string, form: FormData) {
  const session = await guard(receptionistId);
  const id = str(form, "id").trim();
  const phone = await phoneOrNull(str(form, "phone"));
  if (!phone) done(returnTo, "Enter a 10-digit Canadian or US number", "error");
  const category = str(form, "category");
  if (!isCategory(category)) done(returnTo, "Choose what they are to the business", "error");
  const routeAction = str(form, "routeAction");
  const routeTo = routeAction === "transfer" ? await phoneOrNull(str(form, "routeTo")) : null;
  if (routeTo === false) done(returnTo, "Enter a 10-digit number to put them through to, or leave it blank for you", "error");
  const data = {
    phone: phone as string,
    name: str(form, "name").trim().slice(0, 60),
    company: str(form, "company").trim().slice(0, 60),
    category: category as string,
    status: "LABELLED",
    routeAction: (ROUTE_ACTIONS as readonly string[]).includes(routeAction) ? routeAction : "",
    routeTo: routeTo || null,
    labelledBy: session.email,
    labelledAt: new Date(),
  };
  let savedId = id;
  if (id) {
    const existing = await db.knownCaller.findFirst({ where: { id, receptionistId } });
    if (!existing) done(returnTo, "Caller not found", "error");
    const clash = await db.knownCaller.findFirst({ where: { receptionistId, phone: data.phone, id: { not: id } } });
    if (clash) done(returnTo, `${data.phone} is already in the list`, "error");
    await db.knownCaller.update({ where: { id }, data });
  } else {
    const saved = await db.knownCaller.upsert({
      where: { receptionistId_phone: { receptionistId, phone: data.phone } },
      create: { receptionistId, source: session.role === "CLIENT" ? "portal" : "crm", ...data },
      update: data,
    });
    savedId = saved.id;
  }
  // If the next check-in call was going to ask who they are, it no longer needs to.
  await db.openQuestion.updateMany({ where: { receptionistId, key: { in: [`label:${savedId}`, `supplier:${savedId}`] }, status: "OPEN" }, data: { status: "ANSWERED", answeredBy: session.email, answeredAt: new Date() } });
  done(returnTo, "Saved");
}

/** File a caller waiting in the list (from the call log or the evening text) in one click. */
export async function labelPendingCaller(receptionistId: string, id: string, returnTo: string, form: FormData) {
  const session = await guard(receptionistId);
  const label = str(form, "category");
  const existing = await db.knownCaller.findFirst({ where: { id, receptionistId } });
  if (!existing) done(returnTo, "Caller not found", "error");
  if (label !== "DISMISS" && !isCategory(label)) done(returnTo, "Choose what they are", "error");
  const { labelKnownCaller } = await import("@/lib/assistant");
  await labelKnownCaller(id, label === "DISMISS" ? "DISMISS" : (label as Parameters<typeof labelKnownCaller>[1]), session.email, session.role === "CLIENT" ? "portal" : "crm");
  done(returnTo, label === "DISMISS" ? "Skipped" : "Saved");
}

export async function removeKnownCaller(receptionistId: string, id: string, returnTo: string) {
  await guard(receptionistId);
  await db.knownCaller.deleteMany({ where: { id, receptionistId } });
  await db.openQuestion.updateMany({ where: { receptionistId, key: { in: [`label:${id}`, `supplier:${id}`] }, status: "OPEN" }, data: { status: "DISMISSED" } });
  done(returnTo, "Removed from the list");
}

export async function saveDigestSetting(receptionistId: string, returnTo: string, form: FormData) {
  await guard(receptionistId);
  await db.receptionist.update({ where: { id: receptionistId }, data: { labelDigestOn: form.get("labelDigestOn") === "on" } });
  done(returnTo, "Saved");
}

/** Check-in calls (Assistant tier): on/off, how many questions before a call, and the number to call. */
export async function saveCheckinSettings(receptionistId: string, returnTo: string, form: FormData) {
  await guard(receptionistId);
  const raw = str(form, "checkinPhone");
  const phone = await phoneOrNull(raw);
  if (phone === false) done(returnTo, "Enter a 10-digit Canadian or US number to call, or leave it blank", "error");
  const { clampThreshold } = await import("@/lib/customer-text-rules");
  await db.receptionist.update({
    where: { id: receptionistId },
    data: { checkinsOn: form.get("checkinsOn") === "on", checkinThreshold: clampThreshold(Number(str(form, "checkinThreshold"))), checkinPhone: phone || null },
  });
  done(returnTo, "Saved");
}

/** Feedback for the assistant, typed in the portal or CRM: one short rule it follows from now on. */
export async function addCoaching(receptionistId: string, returnTo: string, form: FormData) {
  await guard(receptionistId);
  const rule = str(form, "rule").replace(/\s+/g, " ").trim();
  const { addCoachingRule, coachingProblem } = await import("@/lib/assistant-rules");
  const problem = coachingProblem(rule);
  if (problem) done(returnTo, problem, "error");
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, select: { coaching: true, elevenLabsAgentId: true } });
  const { value, dropped } = addCoachingRule(r.coaching, rule);
  await db.receptionist.update({ where: { id: receptionistId }, data: { coaching: value } });
  if (r.elevenLabsAgentId) resyncLater(receptionistId);
  done(returnTo, dropped ? `Saved. To make room, the oldest feedback was retired: "${dropped}"` : "Saved. It applies to calls within a minute.");
}

export async function removeCoaching(receptionistId: string, index: number, returnTo: string) {
  await guard(receptionistId);
  const { removeCoachingRule } = await import("@/lib/assistant-rules");
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, select: { coaching: true, elevenLabsAgentId: true } });
  await db.receptionist.update({ where: { id: receptionistId }, data: { coaching: removeCoachingRule(r.coaching, index) } });
  if (r.elevenLabsAgentId) resyncLater(receptionistId);
  done(returnTo, "Removed");
}

/** What the owner counts as urgent, and the number urgent calls are put through to (every receptionist). */
export async function saveUrgentCalls(receptionistId: string, returnTo: string, form: FormData) {
  await guard(receptionistId);
  const escalationRules = str(form, "escalationRules").replace(/\s+/g, " ").trim().slice(0, 1000);
  const phone = await phoneOrNull(str(form, "escalationPhone"));
  if (phone === false) done(returnTo, "Enter a 10-digit Canadian or US number for urgent calls, or leave it blank", "error");
  const { looksLikeInstructions } = await import("@/lib/safety-rules");
  if (looksLikeInstructions(escalationRules)) done(returnTo, "Describe which calls are urgent (e.g. \"a customer stranded or unsafe to drive\"), not instructions for the receptionist", "error");
  const r = await db.receptionist.update({ where: { id: receptionistId }, data: { escalationRules, escalationPhone: phone || null } });
  if (r.elevenLabsAgentId) resyncLater(r.id);
  done(returnTo, phone ? "Saved. Urgent calls will be put through within a minute." : "Saved. With no number, urgent calls become urgent messages.");
}

/** A supplier and delivery list: an uploaded CSV, or pasted lines (company, contact, phone). */
export async function importSuppliers(receptionistId: string, returnTo: string, form: FormData) {
  const session = await guard(receptionistId);
  const file = form.get("file");
  const fromFile = file && typeof file === "object" && "text" in file && (file as File).size > 0 ? ((file as File).size > 500_000 ? null : await (file as File).text()) : "";
  if (fromFile === null) done(returnTo, "That file is too big. Save just the supplier names and numbers as a CSV and try again.", "error");
  const { parseSupplierList } = await import("@/lib/assistant-rules");
  const { rows, skipped } = parseSupplierList(`${fromFile}\n${str(form, "list")}`);
  if (!rows.length) done(returnTo, skipped.length ? `No phone numbers found (first line: "${skipped[0]}"). Put one supplier per line with their 10-digit number.` : "Paste or upload a list first", "error");
  if (rows.length > 500) done(returnTo, "That's more than 500 suppliers. Split the list and upload it in parts.", "error");
  const by = session.email;
  const source = session.role === "CLIENT" ? "portal" : "crm";
  for (const row of rows) {
    const data = { name: row.name.slice(0, 60), company: row.company.slice(0, 60), category: "SUPPLIER", status: "LABELLED", labelledBy: by, labelledAt: new Date() };
    const saved = await db.knownCaller.upsert({ where: { receptionistId_phone: { receptionistId, phone: row.phone } }, create: { receptionistId, phone: row.phone, source, ...data }, update: data });
    await db.openQuestion.updateMany({ where: { receptionistId, key: { in: [`supplier:${saved.id}`, `label:${saved.id}`] }, status: "OPEN" }, data: { status: "ANSWERED", answeredBy: by, answeredAt: new Date() } });
  }
  done(returnTo, `Added ${rows.length} supplier${rows.length === 1 ? "" : "s"}.${skipped.length ? ` Skipped ${skipped.length} line${skipped.length === 1 ? "" : "s"} without a phone number.` : ""}`);
}
