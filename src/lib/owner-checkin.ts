import "server-only";
import { randomBytes } from "node:crypto";
import type { CallLog, Receptionist } from "@prisma/client";
import { db } from "./db";
import { appUrl } from "./app-url";
import { companyName } from "./brand";
import { escapeXml, sendSms, toE164, twiml, twilioApi } from "./twilio";
import { appBase } from "./twilio-request";
import { dialerCallerId } from "./dialer";
import { registerTwilioCall, syncReceptionist } from "./elevenlabs";
import { recordKbChange } from "./kb-history";
import { parseAnswers } from "./discovery-rules";
import { looksLikeInstructions } from "./safety-rules";
import { isoDate, localDate } from "./booking";
import { textsCustomers } from "./customer-texts";
import { checkinDue, checkinHours, holidayQuestion, holidaysFor, matchQuestion, parseUnanswered, questionKey, saysClosed, upcomingHolidays } from "./customer-text-rules";

// Weekly owner check-in (rules in customer-text-rules.ts). Calls log the questions the agent
// couldn't answer; upcoming holidays add "are you open?" questions. Once 3-5 caller questions
// pile up, or a holiday is close, a check-in agent calls the owner (at most once a week, weekdays
// 10-4 their time). Answers go straight into the knowledge base (live, in its history). No answer
// twice: the questions go by text with a link to answer them in the portal.

type R = Receptionist;

/** After a call: the questions the agent couldn't answer become open questions (de-duplicated). */
export async function recordUnanswered(r: R, call: CallLog, collected: Record<string, { value?: unknown }>) {
  if (!textsCustomers(r)) return;
  for (const q of parseUnanswered(collected.unanswered_questions?.value)) {
    const key = questionKey(q);
    if (!key) continue;
    const existing = await db.openQuestion.findUnique({ where: { receptionistId_key: { receptionistId: r.id, key } } });
    if (existing) {
      // Asked again: count it, and reopen a dismissed one only if it keeps coming up.
      await db.openQuestion.update({ where: { id: existing.id }, data: { askedCount: { increment: 1 }, ...(existing.status === "DISMISSED" && existing.askedCount >= 2 ? { status: "OPEN" } : {}) } });
    } else {
      await db.openQuestion.create({ data: { receptionistId: r.id, question: q.endsWith("?") ? q : `${q}?`, key, callId: call.id } });
    }
  }
}

function ownerPhone(r: R, accountPhone: string | null): string | null {
  const p = r.checkinPhone || r.ringFirstNumber || r.escalationPhone || accountPhone;
  return p ? toE164(p) : null;
}

/** Add "are you open?" questions for holidays in the next two weeks. */
async function addHolidayQuestions(r: R & { account: { state: string | null } }, now: Date) {
  const today = localDate(now, r.timezone);
  const todayIso = isoDate(today.y, today.m, today.d);
  const country = r.account.state && /^(BC|AB|SK|MB|ON|QC|NB|NS|PE|NL|YT|NT|NU)$/i.test(r.account.state.trim()) ? "CA" : r.account.state && /^[A-Z]{2}$/i.test(r.account.state.trim()) ? "US" : null;
  const list = [...holidaysFor({ bookingHolidays: r.bookingHolidays, timezone: r.timezone, country }, today.y), ...holidaysFor({ bookingHolidays: r.bookingHolidays, timezone: r.timezone, country }, today.y + 1)];
  for (const h of upcomingHolidays(list, todayIso, 14)) {
    // Already marked closed in booking settings: nothing to ask.
    if (r.bookingClosedDates.includes(h.date)) continue;
    await db.openQuestion.upsert({
      where: { receptionistId_key: { receptionistId: r.id, key: `holiday:${h.date}` } },
      create: { receptionistId: r.id, kind: "holiday", question: holidayQuestion(h), key: `holiday:${h.date}`, holidayDate: h.date },
      update: {},
    });
  }
}

/** The shared check-in agent, created (and synced) the first time it's needed. */
export async function checkinAgent(): Promise<R | null> {
  const existing = await db.receptionist.findFirst({ where: { agentType: "checkin" }, orderBy: { createdAt: "asc" } });
  if (existing) return existing.elevenLabsAgentId ? existing : (await syncReceptionist(existing.id).then(() => db.receptionist.findUnique({ where: { id: existing.id } })).catch(() => null));
  const house = await db.receptionist.findFirst({ where: { bookingAddsToCrm: true }, orderBy: { createdAt: "asc" } });
  if (!house) return null;
  const r = await db.receptionist.create({
    data: { accountId: house.accountId, agentType: "checkin", name: "Jordan", businessName: await companyName(), persona: "Friendly, quick and respectful of the owner's time.", ragToken: randomBytes(24).toString("base64url"), timezone: house.timezone },
  });
  await syncReceptionist(r.id).catch((e) => console.error("check-in agent sync", e));
  return db.receptionist.findUnique({ where: { id: r.id } });
}

/** Every 30 minutes in the day: add holiday questions, and call owners whose check-in is due. */
export async function processCheckins(now = new Date()): Promise<{ called: number; texted: number; errors: string[] }> {
  const out = { called: 0, texted: 0, errors: [] as string[] };
  const rs = await db.receptionist.findMany({ where: { checkinsOn: true, lifecycle: "production", agentType: "inbound", bookingAddsToCrm: false, elevenLabsAgentId: { not: null } }, include: { account: { select: { state: true, phone: true } } } });
  for (const r of rs) {
    try {
      await addHolidayQuestions(r, now);
      const phone = ownerPhone(r, r.account.phone);
      if (!phone || !checkinHours(now, r.timezone)) continue;
      const last = await db.ownerCheckin.findFirst({ where: { receptionistId: r.id }, orderBy: { createdAt: "desc" } });
      // A missed check-in is tried once more the next day, then sent by text.
      if (last?.status === "NO_ANSWER" && now.getTime() - (last.finishedAt ?? last.createdAt).getTime() > 20 * 3600_000) {
        if (last.attempts < 2) {
          await db.ownerCheckin.update({ where: { id: last.id }, data: { status: "CALLING", attempts: { increment: 1 } } });
          await placeCall(r, last.id, last.phone);
          out.called++;
        } else if (await textQuestions(r, last.id)) out.texted++;
        continue;
      }
      const open = await db.openQuestion.findMany({ where: { receptionistId: r.id, status: "OPEN" }, orderBy: [{ askedCount: "desc" }, { createdAt: "asc" }] });
      const callerQs = open.filter((q) => q.kind === "caller");
      const holidayQs = open.filter((q) => q.kind === "holiday");
      if (!checkinDue({ lastCheckinAt: last?.createdAt ?? null, openCallerQuestions: callerQs.length, threshold: r.checkinThreshold, holidayDue: holidayQs.length > 0 }, now)) continue;
      // The check-in agent is created and synced before the first call, not while the owner waits.
      const agent = await checkinAgent();
      if (!agent?.elevenLabsAgentId) {
        out.errors.push("The check-in agent isn't ready (it needs your own receptionist, and ElevenLabs connected)");
        break;
      }
      const questions = [...holidayQs, ...callerQs].slice(0, 6);
      const checkin = await db.ownerCheckin.create({ data: { receptionistId: r.id, phone, questionIds: JSON.stringify(questions.map((q) => q.id)) } });
      await placeCall(r, checkin.id, phone);
      out.called++;
    } catch (err) {
      out.errors.push(`${r.id}: ${(err as Error).message.slice(0, 200)}`);
    }
  }
  return out;
}

async function placeCall(r: R, checkinId: string, to: string) {
  const from = r.businessNumber ?? dialerCallerId();
  if (!from) throw new Error("No number to call the owner from");
  const q = `c=${encodeURIComponent(checkinId)}`;
  const call = await twilioApi<{ sid: string }>("/Calls.json", {
    form: { To: to, From: from, Url: `${appBase()}/api/voice/checkin?${q}`, StatusCallback: `${appBase()}/api/voice/checkin/status?${q}`, MachineDetection: "Enable", Timeout: "25" },
  });
  await db.ownerCheckin.update({ where: { id: checkinId }, data: { callSid: call.sid } });
}

async function checkinQuestions(checkinId: string) {
  const c = await db.ownerCheckin.findUnique({ where: { id: checkinId }, include: { receptionist: { include: { account: { select: { name: true } } } } } });
  if (!c) return null;
  const ids = JSON.parse(c.questionIds) as string[];
  const qs = (await db.openQuestion.findMany({ where: { id: { in: ids } } })).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return { c, qs };
}

/** TwiML when the owner's phone answers: a person gets the check-in agent; voicemail gets a text instead. */
export async function checkinTwiml(checkinId: string, answeredBy: string): Promise<string> {
  const found = await checkinQuestions(checkinId);
  if (!found) return twiml("<Hangup/>");
  const { c, qs } = found;
  const r = c.receptionist;
  if (/^machine|^fax/.test(answeredBy)) {
    await db.ownerCheckin.update({ where: { id: c.id }, data: { note: "Reached voicemail" } });
    return twiml(`<Say voice="Google.en-US-Chirp3-HD-Charon">${escapeXml(`Hi, it's ${await companyName()} calling about ${r.name}, your AI receptionist. Callers asked a few questions it couldn't answer. I'll text them to you so you can answer when it suits you. Thanks!`)}</Say><Hangup/>`);
  }
  const agent = await checkinAgent();
  if (!agent?.elevenLabsAgentId) return twiml("<Hangup/>");
  const owner = await db.user.findFirst({ where: { accountId: r.accountId, role: "CLIENT", disabled: false }, select: { name: true } });
  try {
    return await registerTwilioCall(agent.elevenLabsAgentId, r.businessNumber ?? dialerCallerId() ?? "", c.phone, {
      direction: "outbound",
      dynamicVariables: {
        checkin_id: c.id,
        business_name: r.businessName,
        owner_first_name: owner?.name?.split(/\s+/)[0] || "there",
        receptionist_name: r.name,
        questions: qs.map((q, i) => `${i + 1}. ${q.question}`).join("\n"),
      },
    });
  } catch (err) {
    console.error("check-in: register-call failed", err);
    return twiml("<Hangup/>");
  }
}

/** The call ended: reached the owner (the agent saves answers itself), or not (retry / text). */
export async function checkinStatus(checkinId: string, params: Record<string, string>) {
  const c = await db.ownerCheckin.findUnique({ where: { id: checkinId } });
  if (!c || c.status !== "CALLING") return;
  const reached = params.CallStatus === "completed" && !/^machine|^fax/.test(params.AnsweredBy ?? "") && c.note !== "Reached voicemail";
  if (reached) {
    // The agent saves answers during the call; if it didn't, the questions are still open for next time.
    await db.ownerCheckin.update({ where: { id: c.id }, data: { status: "DONE", finishedAt: new Date() } });
    return;
  }
  if (c.note === "Reached voicemail") {
    const r = await db.receptionist.findUnique({ where: { id: c.receptionistId } });
    if (r) await textQuestions(r, c.id);
    return;
  }
  await db.ownerCheckin.update({ where: { id: c.id }, data: { status: "NO_ANSWER", finishedAt: new Date(), note: `Not answered (${params.CallStatus ?? "unknown"})` } });
}

/** Send the owner the open questions by text, with a link to answer them in the portal. */
async function textQuestions(r: R, checkinId: string): Promise<boolean> {
  const found = await checkinQuestions(checkinId);
  if (!found) return false;
  const open = found.qs.filter((q) => q.status === "OPEN");
  await db.ownerCheckin.update({ where: { id: checkinId }, data: { status: "TEXTED", finishedAt: new Date() } });
  if (!open.length) return false;
  const list = open.slice(0, 4).map((q, i) => `${i + 1}. ${q.question}`).join("\n");
  const body = `${await companyName()}: callers asked ${r.name} a few things it couldn't answer:\n${list}\nAnswer them here and ${r.name} will use them right away: ${appUrl().replace(/\/$/, "")}/portal/knowledge`;
  await sendSms(found.c.phone, body.slice(0, 1200), r.businessNumber).catch((e) => console.error("check-in text failed", e));
  return true;
}

/**
 * Answers to open questions, from the check-in call (save_checkin_answers) or typed in the
 * portal/CRM. Each becomes a live knowledge entry (in its history); "closed" on a holiday also
 * closes that day for bookings. Synced right away.
 */
export async function answerQuestions(receptionistId: string, answers: { questionId?: string; question: string; answer: string }[], by: { email: string | null; role: string; label: string }) {
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId } });
  const open = await db.openQuestion.findMany({ where: { receptionistId, status: "OPEN" } });
  let saved = 0;
  const closed: string[] = [];
  for (const a of answers) {
    const answer = a.answer.trim().slice(0, 2000);
    if (!answer || looksLikeInstructions(answer)) continue;
    const q = (a.questionId && open.find((o) => o.id === a.questionId)) || open.find((o) => o.key === questionKey(a.question)) || matchQuestion(a.question, open);
    const title = (q?.question ?? a.question).trim().slice(0, 200);
    const holiday = q?.kind === "holiday";
    await db.$transaction(async (tx) => {
      const data = { receptionistId, category: holiday ? "HOURS" : "FAQ", title, content: answer, tags: "owner-answer", isActive: true, updatedBy: by.email ?? by.label };
      const item = await tx.knowledgeItem.create({ data });
      await recordKbChange(tx, { receptionistId, itemId: item.id, action: "create", before: null, after: data, by: { email: by.email, role: by.role } });
      if (q) await tx.openQuestion.update({ where: { id: q.id }, data: { status: "ANSWERED", answer, answeredBy: by.label, answeredAt: new Date() } });
    });
    if (holiday && q?.holidayDate && saysClosed(answer)) closed.push(q.holidayDate);
    saved++;
  }
  if (closed.length) {
    const lines = new Set(r.bookingClosedDates.split("\n").map((l) => l.trim()).filter(Boolean));
    for (const d of closed) lines.add(d);
    await db.receptionist.update({ where: { id: r.id }, data: { bookingClosedDates: [...lines].sort().join("\n") } });
  }
  if (saved && r.elevenLabsAgentId) await syncReceptionist(r.id).catch((e) => console.error("sync after answers", e));
  return { saved, closedDays: closed };
}

/** save_checkin_answers, from the check-in agent. */
export async function saveCheckinAnswers(checkinId: string, text: string) {
  const found = await checkinQuestions(checkinId);
  if (!found) return { saved: false, message: "This check-in wasn't found. Thank them and end the call." };
  // Lines look like "2. Do you work on diesels: yes". Match by number first, then by the closest question.
  const answers = text.split(/\r?\n/).flatMap((line) => {
    const n = Number(line.match(/^\s*(\d+)[.)]/)?.[1] ?? NaN);
    return parseAnswers(line).map((p) => {
      const q = (Number.isFinite(n) ? found.qs[n - 1] : undefined) ?? matchQuestion(p.question, found.qs) ?? undefined;
      return { questionId: q?.id, question: q?.question ?? p.question, answer: p.answer };
    });
  });
  const res = await answerQuestions(found.c.receptionistId, answers, { email: null, role: "system", label: "owner call" });
  await db.ownerCheckin.update({ where: { id: checkinId }, data: { status: "DONE", finishedAt: new Date(), note: `${res.saved} answer${res.saved === 1 ? "" : "s"} saved` } });
  return { saved: true, message: `Saved ${res.saved} answer${res.saved === 1 ? "" : "s"}${res.closedDays.length ? ` and marked ${res.closedDays.length} holiday as closed for bookings` : ""}. Thank them, and end the call.` };
}
