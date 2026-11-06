import "server-only";
import { randomBytes } from "node:crypto";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { getSetting, setSetting } from "./settings";
import { isClientStage } from "./constants";
import { companyName } from "./brand";
import { toE164, twilioApi } from "./twilio";
import { appBase } from "./twilio-request";
import { matchAccount } from "./agent-booking";
import { newLeadFormKey } from "./followup";
import { callerTypeFor, DEFAULT_MENU_CODE, keypadResult, matchDemoByName, MAX_KEYPAD_TRIES, type CallerType } from "./house-line-rules";
import { teamMemberByPhone } from "./owner-mode";

// Head Above Digital's own line (rules in house-line-rules.ts). The demo number is answered by
// Grace, the company receptionist (the receptionist with "add each booking to this CRM"). She's told
// what kind of caller it is; keypad digits go to the app, which opens the demo menu (owner's code) or
// a demo (its extension) by moving the live call to the demo directory.

export async function houseReceptionist(): Promise<Receptionist | null> {
  return db.receptionist.findFirst({ where: { bookingAddsToCrm: true, agentType: "inbound" }, orderBy: { createdAt: "asc" } });
}

/** The house follow-up agent: calls back the website's "Book a demo" form. */
export async function houseFollowupAgent(): Promise<Receptionist | null> {
  const house = await houseReceptionist();
  if (!house) return null;
  return db.receptionist.findFirst({ where: { accountId: house.accountId, agentType: "followup" }, orderBy: { createdAt: "asc" } });
}

export async function menuCode(): Promise<string> {
  return ((await getSetting("demo.menuCode")) || DEFAULT_MENU_CODE).replace(/\D/g, "") || DEFAULT_MENU_CODE;
}

/** New caller, a prospect we've dealt with, or a client: from their number, for routing only. */
export async function callerType(from: string): Promise<CallerType> {
  if (!from) return "new";
  const { account } = await matchAccount({ phone: from });
  return callerTypeFor(account, isClientStage);
}

/**
 * What Grace is told when a call starts: the caller type, the team member's first name (team only),
 * and her opening line (team members are greeted by name and asked what they'd like to do).
 */
export async function callerContext(from: string, greeting: string): Promise<{ caller_type: CallerType; team_name: string; opening: string }> {
  const team = await teamMemberByPhone(from).catch(() => null);
  if (team) {
    const house = await houseReceptionist();
    return { caller_type: "team", team_name: team.firstName, opening: `Hi${team.firstName ? ` ${team.firstName}` : ""}, it's ${house?.name ?? "Grace"}. What would you like to do? I can open the demo menu, or a demo by company name.` };
  }
  return { caller_type: await callerType(from), team_name: "", opening: greeting };
}

/**
 * open_demo (team callers only): move the call to a demo, by extension or company name, or to the
 * demo menu. The caller's number is checked against the team's mobiles on the live call itself.
 */
export async function openDemoForTeam(callSid: string, wanted: string): Promise<{ message: string; redirect: string | null }> {
  const refuse = { message: "That's only for our team. Carry on helping the caller.", redirect: null };
  if (!/^CA[0-9a-f]{32}$/i.test(callSid)) return refuse;
  const call = await twilioApi<{ status: string; to: string; from: string }>(`/Calls/${callSid}.json`).catch(() => null);
  const number = demoNumber();
  if (!call || call.status !== "in-progress" || !number || toE164(call.to) !== number) return refuse;
  if (!(await teamMemberByPhone(call.from))) return refuse;
  const demos = await db.receptionist.findMany({ where: { demoExtension: { not: null }, elevenLabsAgentId: { not: null }, lifecycle: "demo" }, select: { demoExtension: true, businessName: true }, orderBy: { updatedAt: "desc" }, take: 200 });
  const said = wanted.trim();
  if (!said || /^(the )?(demo )?menu$|directory|list/i.test(said)) return { message: "Say only: \"Opening the demo menu.\"", redirect: `${appBase()}/api/voice/demo?step=menu` };
  const digits = said.replace(/\D/g, "");
  const hit = demos.find((d) => digits && d.demoExtension === digits) ?? matchDemoByName(said, demos);
  if (hit) return { message: `Say only: "Connecting you to ${hit.businessName}."`, redirect: `${appBase()}/api/voice/demo?step=open&ext=${hit.demoExtension}` };
  const names = demos.slice(0, 8).map((d) => `${d.businessName} (${d.demoExtension})`).join(", ");
  return { message: `No demo matches "${said}". ${names ? `Recent demos: ${names}. Ask which one they want.` : "There are no demos set up yet."}`, redirect: null };
}

function demoNumber(): string | null {
  return process.env.TWILIO_DEMO_NUMBER ? toE164(process.env.TWILIO_DEMO_NUMBER) : null;
}

/**
 * keypad_entry: digits Grace heard. Only for a live call to the demo number, a few tries per call.
 * Returns what to tell Grace, and the call redirect to make after she has her answer.
 */
export async function handleKeypad(callSid: string, entered: string): Promise<{ message: string; redirect: string | null }> {
  const silent = { message: "Those digits aren't recognised. Don't mention codes or menus; just carry on helping the caller.", redirect: null };
  if (!/^CA[0-9a-f]{32}$/i.test(callSid)) return silent;
  const triesKey = `keypad.tries.${callSid}`;
  const tries = Number((await getSetting(triesKey)) ?? 0);
  if (tries >= MAX_KEYPAD_TRIES) return silent;
  await setSetting(triesKey, String(tries + 1));
  // The call must be live, and to our demo number.
  const call = await twilioApi<{ status: string; to: string }>(`/Calls/${callSid}.json`).catch(() => null);
  const number = demoNumber();
  if (!call || call.status !== "in-progress" || !number || toE164(call.to) !== number) return silent;

  const extensions = (await db.receptionist.findMany({ where: { demoExtension: { not: null }, elevenLabsAgentId: { not: null } }, select: { demoExtension: true } })).map((r) => r.demoExtension!);
  const digitsKey = `keypad.digits.${callSid}`;
  const res = keypadResult({ previous: (await getSetting(digitsKey)) ?? "", entered, code: await menuCode(), extensions });
  await setSetting(digitsKey, res.digits);
  if (res.action === "menu") return { message: "Say only: \"One moment.\"", redirect: `${appBase()}/api/voice/demo?step=menu` };
  if (res.action === "extension") return { message: "Say only: \"Connecting you to your demo now.\"", redirect: `${appBase()}/api/voice/demo?step=open&ext=${res.extension}` };
  return { ...silent, message: "Not recognised yet. If they're still keying digits, wait; otherwise don't mention codes or menus and carry on helping." };
}

/** Move the live call to the demo directory (ends Grace's part of the call). */
export async function redirectCall(callSid: string, url: string) {
  await twilioApi(`/Calls/${callSid}.json`, { form: { Url: url, Method: "POST" } });
}

export const GRACE_DEFAULT_VOICE = "bnr31VMIPcsgqWJQh7Fs";

/**
 * "Set up Grace": the company receptionist on the demo number, the follow-up agent for the
 * website's demo form, and the owner check-in agent, all with one name and voice. Other demo
 * agents are left alone. Returns the agents to sync.
 */
export async function setupGrace(o: { name: string; voiceId: string }): Promise<{ ids: string[]; notes: string[] }> {
  const house = await houseReceptionist();
  if (!house) throw new Error("No company receptionist found: tick \"Add each booking to this CRM\" on your own receptionist first");
  const company = await companyName();
  const notes: string[] = [];
  await db.receptionist.update({
    where: { id: house.id },
    data: { name: o.name, voiceId: o.voiceId, greeting: `Thanks for calling ${company}, this is ${o.name}. How can I help you today?`, demoExtension: null, lifecycle: "production", syncStatus: "DIRTY" },
  });
  notes.push(`${o.name} answers the demo number as ${company}'s receptionist`);

  let followup = await houseFollowupAgent();
  const followupData = {
    name: o.name,
    voiceId: o.voiceId,
    businessName: company,
    timezone: house.timezone,
    followupGoal: "Book a free 20-minute demo where they hear an AI receptionist built for their own business.",
    followupQuestions: "What kind of business do you run?\nHow do you handle calls now when you can't pick up?",
    followupGuardrails: "Only quote prices in the knowledge base.\nNever promise results or discounts.",
    followupCallHours: "Mon-Sun 08:00-20:00",
    followupDelaySeconds: 60,
    followupMaxAttempts: 2,
    followupTextIfMissed: true,
    leadAlertOn: "leads",
    bookingEnabled: house.bookingEnabled,
    bookingCalendarId: house.bookingCalendarId,
    googleUserId: house.googleUserId,
    bookingTitle: house.bookingTitle,
    bookingSlotMinutes: house.bookingSlotMinutes,
    bookingHours: house.bookingHours,
    bookingMeetingType: house.bookingMeetingType,
    persona: house.persona,
    syncStatus: "DIRTY",
  };
  if (followup) {
    followup = await db.receptionist.update({ where: { id: followup.id }, data: followupData });
  } else {
    followup = await db.receptionist.create({ data: { ...followupData, accountId: house.accountId, agentType: "followup", leadFormKey: newLeadFormKey(), ragToken: randomBytes(24).toString("base64url") } });
    // The house knowledge base, so the follow-up call answers the same way.
    const items = await db.knowledgeItem.findMany({ where: { receptionistId: house.id } });
    if (items.length) await db.knowledgeItem.createMany({ data: items.map((k) => ({ receptionistId: followup!.id, category: k.category, title: k.title, content: k.content, tags: k.tags, isActive: k.isActive, updatedBy: "copied from the receptionist" })) });
  }
  notes.push(`${o.name} calls back the website's "Book a demo" form within about 2 minutes, 8am-8pm`);

  // The owner check-in agent: created now (not on the first check-in), so all three are visible.
  let checkin = await db.receptionist.findFirst({ where: { agentType: "checkin" } });
  const checkinData = { name: o.name, voiceId: o.voiceId, businessName: company, timezone: house.timezone, syncStatus: "DIRTY" };
  checkin = checkin
    ? await db.receptionist.update({ where: { id: checkin.id }, data: checkinData })
    : await db.receptionist.create({ data: { ...checkinData, accountId: house.accountId, agentType: "checkin", persona: "Friendly, quick and respectful of the owner's time.", ragToken: randomBytes(24).toString("base64url") } });
  await setSetting("checkin.name", o.name);
  await setSetting("checkin.voiceId", o.voiceId);
  notes.push(`${o.name} makes the weekly owner check-in calls`);

  return { ids: [house.id, followup.id, checkin.id], notes };
}
