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
import { answersToKnowledge, parseAnswers, pickDiscoveryQuestions, type QA } from "./discovery-rules";

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
      lifecycle: "demo",
    },
  });
  // The trade's template: best-practice settings and starter knowledge, before the website draft.
  const { applyTemplateToNew } = await import("./agent-template-apply");
  await applyTemplateToNew(r.id);
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
  const added = await addAnswersToDemo(account, answers, { who: input.caller_name?.trim() || null, by: house.name, source: `a call with ${house.name}` });
  return {
    result: { saved: true, answers: answers.length, message: "Saved. Tell the caller their demo agent will already know what they just shared, and that anything else can be added during the demo. Then wrap up." },
    background: added.background,
  };
}

type AccountRow = NonNullable<Awaited<ReturnType<typeof db.account.findUnique>>>;

/**
 * Put what a prospect told us into their demo agent's knowledge (live straight away), building
 * the demo agent first if the account has none. Logs it, flags the account for review, and returns
 * the slow part (website draft + ElevenLabs sync) as `background`.
 */
export async function addAnswersToDemo(account: AccountRow, answers: QA[], o: { who: string | null; by: string; source: string; title?: string; tag?: string; intro?: string }) {
  const kb = answersToKnowledge(answers, o.who, new Date(), o.intro);
  if (o.title) kb.title = o.title;
  await recordActivity({ accountId: account.id, type: "NOTE", direction: "INBOUND", source: "receptionist", subject: `Answers for the demo agent from ${o.source} (${answers.length})`, body: kb.content });

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
  await db.knowledgeItem.create({ data: { receptionistId: demo.id, category: "OTHER", title: kb.title, content: kb.content, tags: o.tag ?? "owner-call", isActive: true, updatedBy: o.by } });
  await db.account.update({
    where: { id: account.id },
    data: { needsReview: true, reviewReason: `${answers.length} answer${answers.length === 1 ? "" : "s"} from ${o.source} went into ${existing ? "their demo agent" : "a new demo agent built for them"}: check it before the demo.` },
  });

  const demoId = demo.id;
  const createdById = account.ownerId;
  const background = existing
    ? () => syncReceptionist(demoId).then(() => undefined).catch((e) => console.error("demo agent sync after answers", e))
    : () => finishDemoAgent(demoId, runId, createdById).catch((e) => console.error("demo agent build after answers", e));
  return { demoId, created: !existing, background };
}

const BUILD_FROM_CALL = new Set(["booked", "interested"]);

/**
 * Way 3a: a rep's dialer call where the prospect was interested or booked. The facts they gave
 * (from the call transcript) plus the website draft become their demo agent. Runs once per call;
 * `force` is the "Build demo from this call" button, for any outcome. The slow part (website draft
 * and sync) is returned as `background` for the caller to run after responding.
 */
export async function buildDemoFromCall(activityId: string, opts: { force?: boolean } = {}): Promise<{ ok: boolean; message: string; demoId?: string; background?: () => Promise<void> }> {
  const call = await db.activity.findUnique({ where: { id: activityId }, include: { account: true } });
  if (!call || call.type !== "CALL") return { ok: false, message: "Call not found" };
  if (!opts.force && !BUILD_FROM_CALL.has(call.outcome ?? "")) return { ok: false, message: "Only interested or booked calls build a demo automatically" };
  const transcript = call.body?.split("Transcript:\n")[1]?.trim();
  if (!transcript) return { ok: false, message: "This call has no transcript yet (it appears a minute or two after the call, when Gemini is set up)" };
  const tag = `call:${call.id}`;
  const demoIds = (await db.receptionist.findMany({ where: { accountId: call.accountId, demoExtension: { not: null } }, select: { id: true } })).map((r) => r.id);
  if (demoIds.length && (await db.knowledgeItem.count({ where: { receptionistId: { in: demoIds }, tags: tag } }))) {
    return { ok: true, message: "This call is already in the demo agent", demoId: demoIds[0] };
  }
  // The recording and the rep's outcome can both trigger this at once: only one build per call.
  if (!opts.force) {
    const claimed = await db.setting.create({ data: { key: `demo.fromCall.${call.id}`, value: new Date().toISOString() } }).then(() => true).catch(() => false);
    if (!claimed) return { ok: true, message: "A demo is already being built from this call" };
  }
  const { extractCallFacts } = await import("./ai");
  const facts = await extractCallFacts(transcript, call.account.name);
  if (!facts.length && !call.account.website && !call.account.domain) return { ok: false, message: "The call had no business details and the account has no website, so there's nothing to build the demo from yet" };
  const day = call.occurredAt.toISOString().slice(0, 10);
  let demoId: string;
  let background: (() => Promise<void>) | null;
  if (facts.length) {
    const added = await addAnswersToDemo(call.account, facts, { who: null, by: "sales call", source: `the sales call on ${day}`, title: `From the sales call (${day})`, tag, intro: `What the prospect said about their business on a sales call on ${day}. Use it to answer callers.` });
    demoId = added.demoId;
    background = added.background;
  } else if (demoIds[0]) {
    return { ok: true, message: "No new business details on this call; the demo agent is unchanged", demoId: demoIds[0] };
  } else {
    const created = await createDemoAgent(call.accountId, { createdById: call.createdById, googleUserId: null, bookingEnabled: (await googleConnection()).calendar });
    demoId = created.receptionist.id;
    background = () => finishDemoAgent(demoId, created.runId, call.createdById);
  }
  return { ok: true, background, message: facts.length ? `Added ${facts.length} detail${facts.length === 1 ? "" : "s"} from the call to the demo agent` : "Demo agent being built from the website", demoId };
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
