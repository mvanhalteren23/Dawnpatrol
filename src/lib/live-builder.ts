import "server-only";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { getSetting, setSetting } from "./settings";
import { googleConnection } from "./google";
import { syncReceptionist } from "./elevenlabs";
import { recordActivity } from "./outreach";
import { toE164, twilioApi } from "./twilio";
import { addAnswersToDemo, createDemoAgent, finishDemoAgent } from "./demo-builder";
import { parseAnswers, pickDiscoveryQuestions } from "./discovery-rules";
import { builderQuestions, demoState, isBuilderCode, joinConferenceTwiml, newBuilderCode } from "./builder-rules";
import type { SessionPayload } from "./session";

// Way 3b: the live demo builder on a rep's dialer call (pure parts in builder-rules.ts).
//   startBuilder: the prospect's leg and then the rep's move into a conference, and the builder
//     agent dials in through the demo number with the session code.
//   The builder's webhook tools (get_build_questions … leave_call) act on that session.
//   connectLiveDemo: the builder leaves and the prospect's demo agent dials in (its extension).

export type BuilderSession = {
  code: string;
  accountId: string;
  repId: string | null;
  repName: string;
  prospectName: string;
  parentSid: string; // the rep's browser call
  childSid: string; // the prospect's leg
  builderSid?: string | null;
  demoLegSid?: string | null;
  demoId?: string | null;
  initialDone?: boolean; // the demo agent's first build (website draft + sync) has finished
  answersSavedAt?: string | null;
  createdAt: string;
};

const SESSION_HOURS = 2;
const sessionKey = (code: string) => `builder.session.${code}`;
const parentKey = (sid: string) => `builder.parent.${sid}`;

export async function getBuilderSession(code: string): Promise<BuilderSession | null> {
  if (!isBuilderCode(code)) return null;
  const raw = await getSetting(sessionKey(code));
  const s = raw ? (JSON.parse(raw) as BuilderSession) : null;
  // A session only lives as long as a call: an old code can't be replayed.
  return s && Date.now() - new Date(s.createdAt).getTime() < SESSION_HOURS * 3600_000 ? s : null;
}

async function saveSession(s: BuilderSession) {
  await setSetting(sessionKey(s.code), JSON.stringify(s));
}

async function updateSession(code: string, patch: Partial<BuilderSession>): Promise<BuilderSession | null> {
  const s = await getBuilderSession(code);
  if (!s) return null;
  const next = { ...s, ...patch };
  await saveSession(next);
  return next;
}

/** Daily: drop finished builder sessions and old one-per-call markers from the Setting table. */
export async function cleanupBuilderKeys(now = new Date()): Promise<number> {
  const day = new Date(now.getTime() - 86400_000);
  const twoMonths = new Date(now.getTime() - 60 * 86400_000);
  const res = await db.setting.deleteMany({
    where: {
      OR: [
        { key: { startsWith: "builder." }, updatedAt: { lt: day } },
        { key: { startsWith: "demo.fromCall." }, updatedAt: { lt: twoMonths } },
      ],
    },
  });
  return res.count;
}

/** The builder's dial-in uses its code once; any later call with the same code is refused. */
export async function claimBuilderCode(code: string): Promise<boolean> {
  return db.setting.create({ data: { key: `builder.used.${code}`, value: new Date().toISOString() } }).then(() => true).catch(() => false);
}

/** The session a rep's dialer call is in, if they added the builder to it. */
export async function sessionForParent(parentSid: string): Promise<BuilderSession | null> {
  const code = await getSetting(parentKey(parentSid));
  return code ? getBuilderSession(code) : null;
}

export async function builderAgent(): Promise<Receptionist | null> {
  return db.receptionist.findFirst({ where: { agentType: "builder" }, orderBy: { createdAt: "asc" } });
}

function demoNumber(): string | null {
  const raw = process.env.TWILIO_DEMO_NUMBER;
  return raw ? toE164(raw) : null;
}

/** Is this call one of our own legs dialling the demo line (builder or live demo)? */
export function isInternalLeg(from: string): boolean {
  const n = demoNumber();
  return Boolean(n && from && toE164(from) === n);
}

/** Dial one of our agents into the session's conference through the demo line, "pressing" `digits`. */
async function dialAgentIn(code: string, digits: string): Promise<string> {
  const number = demoNumber();
  if (!number) throw new Error("TWILIO_DEMO_NUMBER is not set");
  const call = await twilioApi<{ sid: string }>("/Calls.json", { form: { To: number, From: number, SendDigits: `wwww${digits}#`, Twiml: joinConferenceTwiml(code, "agent"), Timeout: "20" } });
  return call.sid;
}

async function hangUp(callSid: string | null | undefined) {
  if (!callSid) return;
  await twilioApi(`/Calls/${callSid}.json`, { form: { Status: "completed" } }).catch((e) => console.warn("hang up", callSid, (e as Error).message));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The rep's "Add demo builder" button. Returns the slow part (building the demo agent from the
 * website while the builder asks its questions) as `background`.
 */
export async function startBuilder(parentSid: string, session: SessionPayload): Promise<{ ok: boolean; message: string; background?: () => Promise<void> }> {
  const builder = await builderAgent();
  if (!builder?.elevenLabsAgentId) return { ok: false, message: "The demo builder isn't set up yet (Demo line page → Demo builder)." };
  if (!demoNumber()) return { ok: false, message: "TWILIO_DEMO_NUMBER isn't set, so the builder can't dial in." };
  const existing = await sessionForParent(parentSid);
  if (existing) return { ok: true, message: "The builder is already on this call." };
  const call = await db.activity.findUnique({ where: { externalId: `dialer:${parentSid}` }, include: { account: true, contact: true } });
  if (!call) return { ok: false, message: "This call isn't in the CRM yet. Try again in a moment." };
  if (session.role !== "ADMIN" && call.createdById !== session.sub) return { ok: false, message: "Only the rep on this call can add the builder." };

  const children = await twilioApi<{ calls: { sid: string; status: string }[] }>(`/Calls.json?ParentCallSid=${encodeURIComponent(parentSid)}&Status=in-progress`);
  const child = children.calls[0];
  if (!child) return { ok: false, message: "The prospect isn't connected yet." };

  let code = newBuilderCode();
  while (await getSetting(sessionKey(code))) code = newBuilderCode();
  const rep = session.sub ? await db.user.findUnique({ where: { id: session.sub }, select: { id: true, name: true, email: true } }) : null;
  const account = call.account;

  // Start the demo agent now, so the website draft runs while the builder asks its questions.
  let demo = await db.receptionist.findFirst({ where: { accountId: account.id, demoExtension: { not: null } }, orderBy: { createdAt: "asc" } });
  let runId: string | null = null;
  if (!demo) {
    const repCal = rep ? await googleConnection(rep.id) : null;
    const created = await createDemoAgent(account.id, { createdById: rep?.id ?? null, googleUserId: repCal?.calendar ? rep!.id : null, bookingEnabled: repCal?.calendar || (await googleConnection()).calendar });
    demo = created.receptionist;
    runId = created.runId;
  }

  const s: BuilderSession = {
    code,
    accountId: account.id,
    repId: rep?.id ?? null,
    repName: rep?.name?.split(/\s+/)[0] || "our team",
    prospectName: call.contact?.firstName || "there",
    parentSid,
    childSid: child.sid,
    demoId: demo.id,
    initialDone: Boolean(!runId && demo.syncStatus === "SYNCED"),
    createdAt: new Date().toISOString(),
  };
  await saveSession(s);
  await setSetting(parentKey(parentSid), code);

  // Prospect first: their leg leaves the bridge, the rep's <Dial> ends and its action URL
  // (/api/voice/outbound/status) puts the rep in the same conference.
  await twilioApi(`/Calls/${child.sid}.json`, { form: { Twiml: joinConferenceTwiml(code, "prospect") } });
  const builderSid = await dialAgentIn(code, code);
  await updateSession(code, { builderSid });
  await recordActivity({ accountId: account.id, contactId: call.contactId, type: "NOTE", source: "dialer", subject: "Demo builder joined the call", body: `${builder.name} joined to build ${account.name}'s demo receptionist.`, createdById: rep?.id ?? null });

  const demoId = demo.id;
  const background = async () => {
    if (!s.initialDone) {
      await finishDemoAgent(demoId, runId, rep?.id ?? null).catch((e) => console.error("builder: initial demo build", e));
      const after = await updateSession(code, { initialDone: true });
      // Answers saved while the first build ran: sync again so they're in.
      if (after?.answersSavedAt) await syncReceptionist(demoId).catch((e) => console.error("builder: sync after answers", e));
    }
  };
  return { ok: true, message: `${builder.name} is joining the call.`, background };
}

/** The rep's "Remove AI" button: the builder and any live demo leave; rep and prospect stay. */
export async function removeAgents(parentSid: string) {
  const s = await sessionForParent(parentSid);
  if (!s) return;
  await Promise.all([hangUp(s.builderSid), hangUp(s.demoLegSid)]);
  await updateSession(s.code, { builderSid: null, demoLegSid: null });
}

async function repOnCall(s: BuilderSession): Promise<boolean> {
  const c = await twilioApi<{ status: string }>(`/Calls/${s.parentSid}.json`).catch(() => null);
  return c?.status === "in-progress";
}

type ToolResult = { result: Record<string, unknown>; background?: () => Promise<void> };

const NO_SESSION: ToolResult = { result: { message: "This call isn't linked to a build. Apologise, say the team will follow up, and call leave_call." } };

/** The builder agent's webhook tools. */
export async function builderTool(action: string, code: string, body: { answers?: string }): Promise<ToolResult> {
  const s = await getBuilderSession(code);
  if (!s) return NO_SESSION;
  const account = await db.account.findUnique({ where: { id: s.accountId } });
  if (!account) return NO_SESSION;

  if (action === "questions") {
    const pick = pickDiscoveryQuestions(account);
    return { result: { business: account.name, questions: builderQuestions(pick.questions), message: "Ask these one at a time, in your own words. They can skip any. Then call save_build_answers." } };
  }

  if (action === "answers") {
    const answers = parseAnswers(body.answers ?? "");
    if (!answers.length) return { result: { saved: false, message: "No answers to save. If they answered any questions, call this again with one 'Question: answer' line each." } };
    const builder = await builderAgent();
    const added = await addAnswersToDemo(account, answers, { who: s.prospectName === "there" ? null : s.prospectName, by: builder?.name ?? "demo builder", source: "the demo builder call" });
    const fresh = await updateSession(code, { answersSavedAt: new Date().toISOString(), demoId: added.demoId });
    // While the first build is still running it picks the answers up when it finishes.
    return { result: { saved: true, message: "Saved. Now tell them it takes a minute or two to finish and ask if they'd like to hear it on this call." }, background: fresh?.initialDone ? added.background : undefined };
  }

  if (action === "status") {
    const demo = s.demoId ? await db.receptionist.findUnique({ where: { id: s.demoId } }) : null;
    const state = s.initialDone ? demoState(demo, s.answersSavedAt ? new Date(s.answersSavedAt) : null) : demo?.syncStatus === "FAILED" ? "failed" : "building";
    const rep = await repOnCall(s);
    return {
      result: {
        state,
        rep_on_call: rep,
        message: (state === "ready" ? "Ready. If they want to hear it, call connect_live_demo." : state === "failed" ? `It couldn't be built right now. Apologise; ${s.repName} will show it on the follow-up.` : "Still building. Keep the conversation going and check again in about 20 seconds.") + (rep ? ` ${s.repName} is on the call.` : ` ${s.repName} has left the call.`),
      },
    };
  }

  if (action === "live-demo") {
    const demo = s.demoId ? await db.receptionist.findUnique({ where: { id: s.demoId } }) : null;
    if (!demo?.demoExtension || demoState(demo, s.answersSavedAt ? new Date(s.answersSavedAt) : null) !== "ready") return { result: { connected: false, message: "It isn't ready yet. Call demo_status again in about 20 seconds." } };
    const ext = demo.demoExtension;
    return {
      result: { connected: true, message: "Connecting now. Say a quick goodbye; you'll leave the call in a moment." },
      background: async () => {
        await sleep(2500); // let the goodbye play
        await hangUp(s.builderSid);
        const demoLegSid = await dialAgentIn(code, ext).catch((e) => {
          console.error("builder: live demo dial", e);
          return null;
        });
        await updateSession(code, { builderSid: null, demoLegSid });
        await recordActivity({ accountId: account.id, type: "NOTE", source: "dialer", subject: "Heard their demo receptionist live", body: `Connected to ${demo.name} (demo line extension ${ext}) during the builder call.` });
      },
    };
  }

  if (action === "leave") {
    const rep = await repOnCall(s);
    return {
      result: { message: rep ? `Hand back to ${s.repName} and say goodbye.` : "Thank them, say goodbye, and end there." },
      background: async () => {
        await sleep(3500);
        await hangUp(s.builderSid);
        if (!rep) await hangUp(s.childSid); // nobody else left on the call
        await updateSession(code, { builderSid: null });
      },
    };
  }

  return { result: { message: "Unknown action" } };
}

/** The builder booked the follow-up: into the rep's calendar when they've connected one. */
export async function builderBookingReceptionist(builder: Receptionist, code: string | undefined): Promise<{ r: Receptionist; session: BuilderSession | null }> {
  const s = code ? await getBuilderSession(code) : null;
  if (!s?.repId) return { r: builder, session: s };
  const rep = await googleConnection(s.repId);
  return { r: rep.calendar ? { ...builder, googleUserId: s.repId } : builder, session: s };
}
