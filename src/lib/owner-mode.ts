import "server-only";
import { after } from "next/server";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { getSetting, setSetting } from "./settings";
import { recordKbChange } from "./kb-history";
import { recordActivity } from "./outreach";
import { sendSms, toE164, twilioApi } from "./twilio";
import { formatSlot, isoDate, localDate, zonedTime } from "./booking";
import { deleteEvent } from "./calendar";
import {
  addClosedDates, confirmationText, datesBetween, expiredNote, isOwnerNumber, isUndo, minutesOf, noteTags, OWNER_TAG, ownerNumbers, planProblems, removeClosedDates, type OwnerPlan,
} from "./owner-mode-rules";

// Owner and team mode (rules in owner-mode-rules.ts).

type R = Receptionist;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** An admin or rep whose login has this mobile number. */
export async function teamMemberByPhone(from: string): Promise<{ id: string; firstName: string } | null> {
  if (!from || from.replace(/\D/g, "").length < 10) return null;
  const e164 = toE164(from);
  const users = await db.user.findMany({ where: { role: { in: ["ADMIN", "REP"] }, disabled: false, phone: { not: null } }, select: { id: true, name: true, email: true, phone: true } });
  const u = users.find((x) => isOwnerNumber(e164, [x.phone!]));
  return u ? { id: u.id, firstName: (u.name ?? u.email.split("@")[0] ?? "").split(/\s+/)[0] ?? "" } : null;
}

/** Is this the owner of the business calling or texting their own line? Returns their first name. */
export async function ownerCaller(r: R, from: string): Promise<{ firstName: string } | null> {
  if (!from) return null;
  const portal = await db.user.findMany({ where: { accountId: r.accountId, disabled: false, phone: { not: null } }, select: { name: true, phone: true } });
  if (!isOwnerNumber(from, ownerNumbers(r, portal.map((u) => u.phone)))) return null;
  const named = portal.find((u) => isOwnerNumber(from, [u.phone!]));
  return { firstName: (named?.name ?? "").split(/\s+/)[0] ?? "" };
}

/** The live call's caller, if the call is in progress and to this number. */
export async function liveCaller(callSid: string, to: string | null): Promise<string | null> {
  if (!/^CA[0-9a-f]{32}$/i.test(callSid) || !to) return null;
  const call = await twilioApi<{ status: string; to: string; from: string }>(`/Calls/${callSid}.json`).catch(() => null);
  if (!call || call.status !== "in-progress" || toE164(call.to) !== toE164(to)) return null;
  return call.from;
}

function today(tz: string): { date: string; weekday: string } {
  const d = localDate(new Date(), tz);
  return { date: isoDate(d.y, d.m, d.d), weekday: WEEKDAYS[d.weekday]! };
}

async function plan(r: R, request: string): Promise<OwnerPlan> {
  const { planOwnerRequest } = await import("./ai");
  const t = today(r.timezone);
  return planOwnerRequest({ businessName: r.businessName, today: t.date, weekday: t.weekday, timezone: r.timezone, currentHours: r.businessHours || r.bookingHours, request });
}

type Undo = { closedDates?: string[]; itemId?: string; businessHours?: string; event?: { id: string; calendarId: string; as: string | null }; blockId?: string };

const pretty = (date: string, tz: string) => formatSlot(zonedTime(+date.slice(0, 4), +date.slice(5, 7), +date.slice(8, 10), 12 * 60, tz), tz).replace(/ at .*$/, "");

/** Make the change. Returns what was done, in one sentence for the owner. */
async function applyPlan(r: R, p: OwnerPlan, ctx: { channel: "call" | "text"; byPhone: string; request: string }): Promise<string> {
  const by = { email: `owner ${ctx.byPhone}`, role: "owner" };
  const undo: Undo = {};
  let summary = "";
  const addNote = async (category: string, title: string, content: string, tags: string) => {
    const data = { receptionistId: r.id, category, title, content: `Latest update from the owner (use this over anything else that disagrees): ${content}`, tags, isActive: true, updatedBy: by.email };
    const item = await db.knowledgeItem.create({ data });
    await recordKbChange(db, { receptionistId: r.id, itemId: item.id, action: "create", before: null, after: data, by });
    undo.itemId = item.id;
  };
  const range = p.startDate ? (p.endDate && p.endDate !== p.startDate ? `${pretty(p.startDate, r.timezone)} to ${pretty(p.endDate, r.timezone)}` : pretty(p.startDate, r.timezone)) : "";

  if (p.action === "closed") {
    const dates = datesBetween(p.startDate!, p.endDate);
    const { value, added } = addClosedDates(r.bookingClosedDates, dates);
    await db.receptionist.update({ where: { id: r.id }, data: { bookingClosedDates: value } });
    undo.closedDates = added;
    await addNote("HOURS", `${p.title} (${range})`, p.content, noteTags(p));
    summary = `Closed ${range}: no bookings those days, and callers are told "${p.content}"`;
  } else if (p.action === "special_hours") {
    await addNote("HOURS", `${p.title} (${range})`, p.content, noteTags(p));
    summary = `Special hours ${range}: callers are told "${p.content}"`;
  } else if (p.action === "hours") {
    undo.businessHours = r.businessHours;
    await db.receptionist.update({ where: { id: r.id }, data: { businessHours: p.content } });
    summary = `Regular hours updated to: ${p.content} (online booking hours are unchanged: adjust them in your portal if they should match)`;
  } else if (p.action === "block") {
    const allDay = !p.startTime || !p.endTime;
    const [y, m, d] = [+p.startDate!.slice(0, 4), +p.startDate!.slice(5, 7), +p.startDate!.slice(8, 10)];
    const end = p.endDate || p.startDate!;
    const start = zonedTime(y, m, d, allDay ? 0 : minutesOf(p.startTime!), r.timezone);
    const finish = allDay
      ? zonedTime(+end.slice(0, 4), +end.slice(5, 7), +end.slice(8, 10) + 1, 0, r.timezone)
      : zonedTime(y, m, d, minutesOf(p.endTime!), r.timezone);
    // Their own Google Calendar, ours, or the CRM's built-in calendar: blocked either way.
    const { blockTime, calendarFor } = await import("./booking-calendar");
    const done = await blockTime(r, await calendarFor(r), { start, end: finish, title: `Blocked: ${p.title}`, description: `Blocked by the owner (${ctx.channel}): "${ctx.request.slice(0, 300)}". No appointments are booked in this time.` });
    if (done.blockId) undo.blockId = done.blockId;
    if (done.eventId) undo.event = { id: done.eventId, calendarId: done.calendarId!, as: done.as ?? null };
    summary = `Calendar blocked ${allDay ? range : `${range}, ${p.startTime} to ${p.endTime}`}: nothing will be booked then`;
  } else if (p.action === "info") {
    await addNote("FAQ", p.title, p.content, noteTags(p));
    summary = `Callers will now be told: "${p.content}"`;
  } else {
    throw new Error("Nothing to change");
  }

  await db.ownerUpdate.create({ data: { receptionistId: r.id, channel: ctx.channel, byPhone: toE164(ctx.byPhone), request: ctx.request.slice(0, 2000), kind: p.action, summary, undo: JSON.stringify(undo) } });
  await recordActivity({ accountId: r.accountId, type: "NOTE", source: "system", subject: `Owner update by ${ctx.channel}`, body: `${summary}.\nRequest: "${ctx.request.slice(0, 500)}" (from ${ctx.byPhone})` });
  if (undo.itemId || undo.businessHours !== undefined) resyncLater(r.id);
  return summary;
}

/** Push knowledge/prompt changes to ElevenLabs after the response (a sync takes a while). */
function resyncLater(receptionistId: string) {
  try {
    after(() => resync(receptionistId));
  } catch {
    void resync(receptionistId); // outside a request (scripts)
  }
}

async function resync(receptionistId: string) {
  const { markDirty, syncReceptionist } = await import("./elevenlabs");
  await markDirty(receptionistId);
  await syncReceptionist(receptionistId).catch((e) => console.error("owner update sync", e));
}

/** Reverse the latest change (within 7 days) on this agent. */
export async function undoLatest(r: R): Promise<string> {
  const last = await db.ownerUpdate.findFirst({ where: { receptionistId: r.id, undoneAt: null, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, orderBy: { createdAt: "desc" } });
  if (!last) return "There's nothing recent to undo.";
  const u = JSON.parse(last.undo) as Undo;
  const fresh = await db.receptionist.findUniqueOrThrow({ where: { id: r.id } });
  if (u.closedDates?.length) await db.receptionist.update({ where: { id: r.id }, data: { bookingClosedDates: removeClosedDates(fresh.bookingClosedDates, u.closedDates) } });
  if (u.businessHours !== undefined) await db.receptionist.update({ where: { id: r.id }, data: { businessHours: u.businessHours } });
  if (u.itemId) {
    const item = await db.knowledgeItem.findUnique({ where: { id: u.itemId } });
    if (item) {
      await db.knowledgeItem.delete({ where: { id: item.id } });
      await recordKbChange(db, { receptionistId: r.id, itemId: item.id, action: "delete", before: item, after: null, by: { email: "owner (undo)", role: "owner" } });
    }
  }
  if (u.event) await deleteEvent(u.event.calendarId, u.event.id, u.event.as).catch((e) => console.warn("undo calendar block", e));
  if (u.blockId) await db.calendarBlock.deleteMany({ where: { id: u.blockId } });
  await db.ownerUpdate.update({ where: { id: last.id }, data: { undoneAt: new Date() } });
  await recordActivity({ accountId: r.accountId, type: "NOTE", source: "system", subject: "Owner update undone", body: `Undone: ${last.summary}` });
  if (u.itemId || u.businessHours !== undefined) resyncLater(r.id);
  return `Undone: ${last.summary}.`;
}

/** Recent calls and who's waiting for a call back. */
export async function ownerMessages(r: R): Promise<string> {
  const t = today(r.timezone);
  const startToday = zonedTime(+t.date.slice(0, 4), +t.date.slice(5, 7), +t.date.slice(8, 10), 0, r.timezone);
  const [todayCount, open] = await Promise.all([
    db.callLog.count({ where: { receptionistId: r.id, startedAt: { gte: startToday }, outcome: { not: "SPAM" } } }),
    db.callLog.findMany({ where: { receptionistId: r.id, followUpNeeded: true, followedUpAt: null, startedAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, orderBy: { startedAt: "desc" }, take: 5 }),
  ]);
  const lines = open.map((c) => `${c.callerName || "Unknown caller"}${c.callerNumber ? ` (${c.callerNumber})` : ""}, ${formatSlot(c.startedAt, r.timezone)}: ${(c.summary || "no summary").slice(0, 160)}`);
  return `${todayCount} call${todayCount === 1 ? "" : "s"} today. ${open.length ? `Waiting for a call back:\n${lines.join("\n")}` : "Nobody is waiting for a call back."}`;
}

/**
 * The owner_request tool during a call: first a plan to read back (confirmed = false), then the
 * change once they say yes (confirmed = true, applying exactly the plan they heard).
 */
export async function ownerRequestOnCall(r: R, callSid: string, request: string, confirmed: boolean): Promise<string> {
  const from = await liveCaller(callSid, r.businessNumber);
  if (!from || !(await ownerCaller(r, from))) return "This isn't the owner's phone, so no changes can be made on this call. Say the owner can call from their own phone, text this number from it, or use their portal.";
  const key = `owner.pending.${callSid}`;
  if (!confirmed) {
    const p = await plan(r, request);
    if (p.action === "messages") return `Read these to the owner: ${await ownerMessages(r)}`;
    if (p.action === "unclear") return `Ask the owner: ${p.question ?? "What would you like to change?"}`;
    const problems = planProblems(p, today(r.timezone).date);
    if (problems.length) return `Ask the owner for ${problems.join(" and ")}.`;
    await setSetting(key, JSON.stringify({ request, plan: p }));
    return `Read this back and ask them to confirm: "${p.confirm}" If they say yes, call owner_request again with confirmed true. If they change anything, call it again with confirmed false and the corrected request.`;
  }
  const pending = await getSetting(key);
  if (!pending) return "Nothing is waiting to be confirmed. Call owner_request with confirmed false first.";
  const { request: original, plan: p } = JSON.parse(pending) as { request: string; plan: OwnerPlan };
  await setSetting(key, "");
  try {
    const summary = await applyPlan(r, p, { channel: "call", byPhone: from, request: original });
    await sendSms(from, confirmationText({ businessName: r.businessName, summary, channel: "call" }), r.businessNumber).catch((e) => console.warn("owner confirmation text", e));
    return `Done. Tell the owner: ${summary}. A confirmation text is on its way; they can reply UNDO to reverse it. Ask if there's anything else.`;
  } catch (err) {
    return `That couldn't be done: ${(err as Error).message} Tell the owner, and offer an alternative.`;
  }
}

/** A text from an owner number: UNDO, messages, or a change (applied, then confirmed with UNDO). */
export async function handleOwnerText(r: R, from: string, body: string): Promise<string> {
  if (isUndo(body)) return undoLatest(r);
  const p = await plan(r, body);
  if (p.action === "messages") return ownerMessages(r);
  if (p.action === "unclear") return `${p.question ?? "What would you like to change?"} (You can text things like "closed next Monday", "block 2-4pm Thursday", "tell callers we now do heat pumps", or "messages".)`;
  const problems = planProblems(p, today(r.timezone).date);
  if (problems.length) return `I need ${problems.join(" and ")} to do that. Could you send it again with that included?`;
  try {
    const summary = await applyPlan(r, p, { channel: "text", byPhone: from, request: body });
    return confirmationText({ businessName: r.businessName, summary, channel: "text" });
  } catch (err) {
    return `That couldn't be done: ${(err as Error).message}`;
  }
}

/** Dated owner notes switch themselves off after their last date (run daily). */
export async function expireOwnerNotes(): Promise<number> {
  const items = await db.knowledgeItem.findMany({ where: { isActive: true, tags: { contains: `${OWNER_TAG},until:` } }, include: { receptionist: { select: { timezone: true } } } });
  let n = 0;
  const touched = new Set<string>();
  for (const k of items) {
    if (!expiredNote(k.tags, today(k.receptionist.timezone).date)) continue;
    await db.knowledgeItem.update({ where: { id: k.id }, data: { isActive: false } });
    touched.add(k.receptionistId);
    n++;
  }
  for (const id of touched) await resync(id);
  return n;
}
