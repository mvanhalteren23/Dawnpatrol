import "server-only";
import { randomBytes } from "node:crypto";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { googleConnection, supportAddress } from "./google";
import { executeKbDraft, startKbDraft } from "./jobs";
import { syncReceptionist } from "./elevenlabs";
import { recordActivity, sendPlainEmail } from "./outreach";
import { demoLineConfig, formatPhone } from "./demo-line";
import { nextFreeExtension } from "./twilio";
import { companyName } from "./brand";
import { addDays } from "./utils";
import { isClientStage } from "./constants";
import { matchAccount } from "./agent-booking";
import { answersToKnowledge, parseAnswers, pickDiscoveryQuestions } from "./discovery-rules";

// Demo agents for prospects, and the server side of the company receptionist's sales tools:
// get_personalization_questions, save_personalization_answers and take_client_message.

async function freeExtension(): Promise<string> {
  const taken = await db.receptionist.findMany({ where: { demoExtension: { not: null } }, select: { demoExtension: true } });
  return nextFreeExtension(taken.map((t) => t.demoExtension));
}

/**
 * Create a prospect's demo receptionist (its own demo-line extension). Returns the KB-draft run
 * to finish with finishDemoAgent, or null when the account has no website to draft from.
 */
export async function createDemoAgent(accountId: string, opts: { name?: string; createdById: string | null; googleUserId: string | null; bookingEnabled: boolean }) {
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const r = await db.receptionist.create({
    data: {
      accountId,
      name: opts.name || "Ava",
      businessName: account.name,
      ragToken: randomBytes(24).toString("base64url"),
      demoExtension: await freeExtension(),
      createdById: opts.createdById,
      googleUserId: opts.googleUserId,
      bookingEnabled: opts.bookingEnabled,
      bookingTitle: `Demo booking (${account.name})`,
      bookingAddsToCrm: false, // demo bookings are pretend customers, not leads
    },
  });
  const runId = account.website || account.domain ? await startKbDraft(r.id) : null;
  return { receptionist: r, runId };
}

/** Draft the knowledge from the website (drafts go live: it's a demo), sync, and log where to call it. */
export async function finishDemoAgent(receptionistId: string, runId: string | null, createdById: string | null) {
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId } });
  if (runId) {
    await executeKbDraft(runId);
    await db.knowledgeItem.updateMany({ where: { receptionistId, tags: "claude-draft" }, data: { isActive: true } });
  }
  await syncReceptionist(receptionistId);
  const { number } = await demoLineConfig();
  await recordActivity({ accountId: r.accountId, type: "NOTE", source: "system", subject: "Demo receptionist ready", body: `Call ${number ? formatPhone(number) : "the demo line"}, extension ${r.demoExtension}, to hear ${r.name} answer for ${r.businessName}.`, createdById });
}

type CallerInput = { caller_name?: string; caller_phone?: string; caller_email?: string; business_name?: string; business_type?: string };

const callerMatch = (input: CallerInput) => matchAccount({ email: input.caller_email, phone: input.caller_phone, businessName: input.business_name });

/** get_personalization_questions: the account's researched questions, else its trade's set. */
export async function personalizationQuestions(input: CallerInput) {
  const { account } = await callerMatch(input);
  const pick = pickDiscoveryQuestions(account, input.business_type);
  return {
    questions: pick.questions,
    message: `Ask these one at a time, in your own words, and keep it relaxed: the caller can skip any or stop at any point. Then call save_personalization_answers with every question you asked and the caller's answer.`,
  };
}

/**
 * save_personalization_answers: log the answers on the caller's account and add them to the
 * account's demo agent (built now if it doesn't have one). Returns the slow part as `background`,
 * run after the agent has its answer.
 */
export async function savePersonalizationAnswers(house: Receptionist, input: CallerInput & { answers?: string; conversation_id?: string }) {
  const answers = parseAnswers(input.answers ?? "");
  if (!answers.length) return { result: { saved: false, message: "No answers to save. If the caller answered any questions, call this again with one 'Question: answer' line each; otherwise thank them and wrap up." }, background: null };

  let { account } = await callerMatch(input);
  if (!account) {
    // Normally book_appointment already created the account; a failed or skipped booking may not have.
    account = await db.account.create({
      data: { name: input.business_name?.trim() || input.caller_name?.trim() || "Caller", phone: input.caller_phone?.trim() || null, industry: input.business_type?.trim() || null, source: "inbound", notes: `Created from a call with ${house.name}.` },
    });
  }
  const kb = answersToKnowledge(answers, input.caller_name ?? null, new Date());
  await recordActivity({ accountId: account.id, type: "NOTE", direction: "INBOUND", source: "receptionist", subject: `Personalization answers from the call (${answers.length})`, body: kb.content });

  const existing = await db.receptionist.findFirst({ where: { accountId: account.id, demoExtension: { not: null } }, orderBy: { createdAt: "asc" } });
  let demo = existing;
  let runId: string | null = null;
  if (!demo) {
    // Bookings on the demo go to the account owner's calendar when they've connected one, else the company's.
    const owner = account.ownerId ? await googleConnection(account.ownerId) : null;
    const googleUserId = owner?.calendar ? account.ownerId : null;
    const calendar = googleUserId ? true : (await googleConnection()).calendar;
    const created = await createDemoAgent(account.id, { createdById: account.ownerId, googleUserId, bookingEnabled: calendar });
    demo = created.receptionist;
    runId = created.runId;
  }
  await db.knowledgeItem.create({ data: { receptionistId: demo.id, category: "OTHER", title: kb.title, content: kb.content, tags: "owner-call", isActive: true, updatedBy: house.name } });
  await db.account.update({
    where: { id: account.id },
    data: { needsReview: true, reviewReason: `${input.caller_name?.trim() || "The caller"} answered ${answers.length} personalization question${answers.length === 1 ? "" : "s"} on a call with ${house.name}. They're in ${existing ? "their demo agent" : "a new demo agent built for them"}: check it before the demo.` },
  });

  const demoId = demo.id;
  const createdById = account.ownerId;
  const background = existing
    ? () => syncReceptionist(demoId).then(() => undefined).catch((e) => console.error("demo agent sync after answers", e))
    : () => finishDemoAgent(demoId, runId, createdById).catch((e) => console.error("demo agent build after answers", e));
  return {
    result: { saved: true, answers: answers.length, message: "Saved. Tell the caller their demo agent will already know what they just shared, and that anything else can be added during the demo. Then wrap up." },
    background,
  };
}

/** take_client_message: an existing client's request, emailed to support (team@) and logged on their account. */
export async function takeClientMessage(house: Receptionist, input: CallerInput & { request?: string; urgency?: string }) {
  const request = input.request?.trim();
  if (!request || !input.caller_phone?.trim()) return { sent: false, message: "Get what they need and their best phone number, then call this again." };
  const { account } = await callerMatch(input);
  const isClient = account ? isClientStage(account.stage) : false;
  const urgent = input.urgency === "urgent";
  const who = [input.caller_name?.trim(), input.business_name?.trim() || account?.name].filter(Boolean).join(", ") || "A caller";
  const body = [
    `${who} called ${house.name} with a request.`,
    "",
    `Request: ${request}`,
    `Urgency: ${urgent ? "URGENT" : "normal"}`,
    `Phone: ${input.caller_phone.trim()}`,
    input.caller_email ? `Email: ${input.caller_email.trim()}` : null,
    "",
    account ? `${isClient ? "Client" : "Account (not marked as a client)"}: ${account.name}` : "Not matched to an account in the CRM: check who this is.",
  ].filter((l) => l !== null).join("\n");

  if (account) {
    await recordActivity({ accountId: account.id, type: "TASK", direction: "INBOUND", source: "receptionist", subject: `${urgent ? "URGENT: " : ""}Client request: ${request.slice(0, 80)}`, body, dueAt: addDays(new Date(), urgent ? 0 : 1) });
  }
  const to = await supportAddress();
  let sent = false;
  if (to) {
    sent = await sendPlainEmail({ to, subject: `${urgent ? "URGENT — " : ""}Client request from ${who}`, body, fromName: await companyName(), replyTo: input.caller_email?.includes("@") ? input.caller_email.trim() : null })
      .then(() => true)
      .catch((e) => {
        console.error("client message email", e);
        return false;
      });
  }
  return {
    sent: sent || Boolean(account),
    message: sent || account
      ? `Got it. Tell the caller the team has their request and will get back to them ${urgent ? "as soon as possible" : "within one business day"}, at ${input.caller_phone.trim()}.`
      : "The message couldn't be delivered. Apologise, and ask them to email the team or call back later.",
  };
}
