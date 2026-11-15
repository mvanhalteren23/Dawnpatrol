import "server-only";
import { db } from "./db";
import { dialerCallerId, ensureCallActivity } from "./dialer";
import { dialableNumber, dialOut, samePhone, say, twilioApi, twiml } from "./twilio";
import { appBase } from "./twilio-request";
import { OwnershipError, touchAccount } from "./team";
import { MAX_IDLE_WAITS, WAIT_SECONDS, isFinalLegStatus, legKey, parsePending, type PendingDial } from "./dialer-bridge-rules";

// "Call my phone" dialer: Twilio calls the rep's mobile once (they press 1), and that call stays up
// for the whole session. Each prospect is dialled from it with the same TwiML as the browser dialer
// (business caller ID, recording, answering-machine detection, voicemail drop), so everything
// downstream is unchanged. Between calls the rep's phone waits in silence.

const ACTIVE = ["CALLING", "READY", "DIALING"];

export async function activeBridge(userId: string) {
  return db.dialerBridge.findFirst({ where: { userId, state: { in: ACTIVE }, updatedAt: { gte: new Date(Date.now() - (MAX_IDLE_WAITS + 1) * WAIT_SECONDS * 1000) } }, orderBy: { createdAt: "desc" } });
}

const base = () => appBase();

/** Ring the rep's mobile. Ends any earlier session of theirs first. */
export async function startBridge(userId: string): Promise<{ id: string } | { error: string }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { phone: true } });
  const phone = user?.phone ? dialableNumber(user.phone) : null;
  if (!phone) return { error: "Add your mobile in Settings → Phone & app first." };
  const callerId = dialerCallerId();
  if (!callerId) return { error: "The dialer isn't set up (no caller ID)." };
  const old = await activeBridge(userId);
  if (old) await endBridge(userId, old.id, "Replaced by a new session.");
  const b = await db.dialerBridge.create({ data: { userId, phone } });
  try {
    const call = await twilioApi<{ sid: string }>("/Calls.json", {
      form: {
        To: phone,
        From: callerId,
        Url: `${base()}/api/voice/bridge/answer?b=${b.id}`,
        StatusCallback: `${base()}/api/voice/bridge/status?b=${b.id}`,
        StatusCallbackEvent: "answered completed",
        Timeout: "30",
      },
    });
    await db.dialerBridge.update({ where: { id: b.id }, data: { repCallSid: call.sid } });
    return { id: b.id };
  } catch (err) {
    await db.dialerBridge.update({ where: { id: b.id }, data: { state: "ENDED", endedReason: "Couldn't call your phone." } });
    return { error: `Couldn't call your phone: ${(err as Error).message}` };
  }
}

/** The rep pressed 1 (or the last prospect call ended): wait for the next dial. */
export function waitTwiml(bridgeId: string, n: number, greeting: string | null): string {
  if (n >= MAX_IDLE_WAITS) return twiml(`${say("The dialer has been idle for a while, so we're hanging up. Start again from the app.")}<Hangup/>`);
  return twiml(`${greeting ? say(greeting) : ""}<Pause length="${WAIT_SECONDS}"/><Redirect method="POST">${base()}/api/voice/bridge/wait?b=${bridgeId}&amp;n=${n + 1}</Redirect>`);
}

/** TwiML for the next prospect, or null when nothing is queued. */
export async function nextDialTwiml(bridgeId: string): Promise<string | null> {
  const b = await db.dialerBridge.findUnique({ where: { id: bridgeId } });
  const p = parsePending(b?.pending);
  if (!b || !p || b.state === "ENDED") return null;
  const claimed = await db.dialerBridge.updateMany({ where: { id: b.id, pending: b.pending }, data: { pending: "", state: "DIALING", legKey: p.key, legSid: null, legStatus: "queued" } });
  if (!claimed.count) return null; // another request took it
  const callerId = dialerCallerId();
  if (!callerId) return twiml(`${say("The dialer isn't set up.")}<Hangup/>`);
  await ensureCallActivity({ callSid: p.key, accountId: p.accountId, contactId: p.contactId, to: p.to, userId: b.userId });
  const q = `a=${p.accountId}&c=${p.contactId ?? ""}&p=${p.key}`;
  return dialOut({
    to: p.to,
    callerId,
    action: `${base()}/api/voice/outbound/status?${q}&b=${b.id}`,
    recordingCallback: `${base()}/api/voice/outbound/recording?${q}`,
    amdCallback: p.vm ? `${base()}/api/voice/outbound/amd?${q}&vm=${p.vm}&vmId=${encodeURIComponent(p.vmId)}` : null,
    legStatusCallback: `${base()}/api/voice/bridge/leg?b=${b.id}&k=${p.key}`,
  });
}

/**
 * Queue a prospect call on the rep's open line and switch the line to it now. The same checks as
 * the browser dialer: only the account's own numbers, and only accounts the rep may work.
 */
export async function requestDial(userId: string, role: "ADMIN" | "REP", bridgeId: string, d: { accountId: string; contactId: string | null; to: string; vm: string | null; vmId: string }): Promise<{ key: string } | { error: string }> {
  const b = await db.dialerBridge.findFirst({ where: { id: bridgeId, userId } });
  if (!b || b.state === "ENDED") return { error: "Your phone isn't connected. Start again." };
  if (b.state === "CALLING") return { error: "Answer your phone and press 1 first." };
  if (b.state === "DIALING" && !isFinalLegStatus(b.legStatus)) return { error: "A call is still in progress." };
  const to = dialableNumber(d.to);
  const account = await db.account.findUnique({ where: { id: d.accountId }, select: { id: true, phone: true, contacts: { select: { phone: true } } } });
  if (!to || !account) return { error: "That number can't be dialled from the CRM." };
  if (![account.phone, ...account.contacts.map((c) => c.phone)].some((p) => samePhone(p, to))) return { error: "That number isn't on this account." };
  try {
    await touchAccount({ sub: userId, role }, account.id);
  } catch (err) {
    if (err instanceof OwnershipError) return { error: err.message };
    throw err;
  }
  const vm = d.vm && ["self", "recorded", "ai", "hangup"].includes(d.vm) ? d.vm : null;
  const key = legKey(b.id, b.dials + 1);
  const pending: PendingDial = { key, accountId: account.id, contactId: d.contactId || null, to, vm, vmId: d.vmId };
  await db.dialerBridge.update({ where: { id: b.id }, data: { pending: JSON.stringify(pending), dials: { increment: 1 }, legKey: key, legSid: null, legStatus: "queued", state: "DIALING" } });
  // Interrupt the wait so the call starts right away.
  try {
    await twilioApi(`/Calls/${b.repCallSid}.json`, { form: { Url: `${base()}/api/voice/bridge/next?b=${b.id}`, Method: "POST" } });
  } catch (err) {
    // The rep's call has ended (hung up, or no signal): the session is over.
    await db.dialerBridge.update({ where: { id: b.id }, data: { state: "ENDED", pending: "", legStatus: "canceled", endedReason: "Your phone's call had ended." } });
    console.warn("bridge redirect failed", (err as Error).message);
    return { error: "Your phone isn't connected any more. Start again." };
  }
  return { key };
}

/** Hang up the prospect, keep the rep's line open. */
export async function hangUpLeg(userId: string, bridgeId: string): Promise<void> {
  const b = await db.dialerBridge.findFirst({ where: { id: bridgeId, userId } });
  if (!b || b.state !== "DIALING") return;
  if (b.legSid && !isFinalLegStatus(b.legStatus)) {
    // Ending the prospect's leg returns the rep to the <Dial action> (logged as usual), then the wait.
    await twilioApi(`/Calls/${b.legSid}.json`, { form: { Status: "completed" } }).catch((e) => console.warn("bridge leg hangup", e));
  } else if (b.repCallSid) {
    // Not ringing yet: cancel by sending the rep back to waiting.
    await db.dialerBridge.update({ where: { id: b.id }, data: { pending: "", state: "READY", legStatus: "canceled" } });
    await twilioApi(`/Calls/${b.repCallSid}.json`, { form: { Url: `${base()}/api/voice/bridge/wait?b=${b.id}&n=0`, Method: "POST" } }).catch((e) => console.warn("bridge cancel", e));
  }
}

export async function endBridge(userId: string, bridgeId: string, reason = "Ended from the app."): Promise<void> {
  const b = await db.dialerBridge.findFirst({ where: { id: bridgeId, userId } });
  if (!b || b.state === "ENDED") return;
  await db.dialerBridge.update({ where: { id: b.id }, data: { state: "ENDED", pending: "", endedReason: reason } });
  if (b.legSid && !isFinalLegStatus(b.legStatus)) await twilioApi(`/Calls/${b.legSid}.json`, { form: { Status: "completed" } }).catch(() => undefined);
  if (b.repCallSid) await twilioApi(`/Calls/${b.repCallSid}.json`, { form: { Status: "completed" } }).catch(() => undefined);
}
