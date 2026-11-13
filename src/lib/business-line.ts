import "server-only";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { registerTwilioCall } from "./elevenlabs";
import { slotRules } from "./agent-booking";
import { isOpenAt } from "./booking";
import { attachNumber, buyNumber, cleanDigits, findLocalNumber, releaseNumber, say, toE164, twiml } from "./twilio";
import { appBase } from "./twilio-request";
import { ownerCaller } from "./owner-mode";

// Business line ("ring my cell first, then the receptionist"):
//   caller → business number → /api/voice/business → rings ringFirstNumber for ringSeconds with a
//   "press 1 to answer" screen → /after: answered = done; otherwise → ElevenLabs agent.
// Texts to the number are forwarded to the cell (/api/sms/business).

export function lineWebhooks() {
  return { voice: `${appBase()}/api/voice/business`, sms: `${appBase()}/api/sms/business` };
}

/** Should this call ring the owner first right now? */
export function shouldRingFirst(r: Receptionist, now = new Date()): boolean {
  if (!r.ringFirstNumber || r.ringMode === "never") return false;
  if (r.ringMode === "always") return true;
  try {
    return isOpenAt(slotRules(r), now);
  } catch {
    return true; // unreadable hours: fall back to ringing
  }
}

/**
 * TwiML that hands the call to the receptionist's ElevenLabs agent. The agent is told whether the
 * caller is the owner (matched from their number; see src/lib/owner-mode.ts).
 */
export async function toAgent(r: Receptionist, from: string, to: string, callSid = ""): Promise<string> {
  const { agentUnavailable, guardedHandoff } = await import("./agent-fallback");
  // No agent, or it can't be reached: the caller leaves a message instead of hitting a dead end.
  if (!r.elevenLabsAgentId) return agentUnavailable(r, "no voice agent is set up for this line");
  try {
    const owner = await ownerCaller(r, from).catch(() => null);
    // Returning callers: what our own records say about this number (empty for new callers and the owner).
    const caller_context = owner ? "" : await (await import("./caller-memory")).callerMemory(r, from);
    const handoff = await registerTwilioCall(r.elevenLabsAgentId, from, to, {
      dynamicVariables: { caller_role: owner ? "owner" : "customer", owner_name: owner?.firstName ? ` ${owner.firstName}` : "", caller_context, call_sid: callSid },
    });
    // If the agent drops the call in its first seconds, the caller is sent to voicemail.
    return guardedHandoff(r, handoff);
  } catch (err) {
    console.error("business line: register-call failed", err);
    return agentUnavailable(r, (err as Error).message ?? "the agent couldn't be reached");
  }
}

/** Buy a local number in `areaCode` (or point an existing Twilio number at the CRM) for this receptionist. */
export async function provisionLine(receptionistId: string, opts: { areaCode?: string; existing?: string }) {
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId } });
  if (r.businessNumber) throw new Error(`${r.businessName} already has ${r.businessNumber}`);
  const hooks = lineWebhooks();
  if (!hooks.voice.startsWith("https://")) throw new Error("APP_URL must be the public https URL of the CRM");
  const label = `${r.businessName} — business line`;
  let number;
  if (opts.existing) {
    number = await attachNumber(toE164(opts.existing), label, hooks.voice, hooks.sms);
  } else {
    const area = cleanDigits(opts.areaCode).slice(-3);
    if (area.length !== 3) throw new Error("Enter a 3-digit area code");
    // Canadian area codes first (this is a BC business); the same search works for US codes.
    const found = (await findLocalNumber("CA", area)) ?? (await findLocalNumber("US", area));
    if (!found) throw new Error(`No numbers available in area code ${area} right now. Try a nearby code (BC: 604, 778, 236, 672, 250).`);
    number = await buyNumber(found, label, hooks.voice, hooks.sms);
  }
  await db.receptionist.update({ where: { id: r.id }, data: { businessNumber: number.phone_number, businessNumberSid: number.sid } });
  return number.phone_number;
}

/** Stop using the line. `release` gives the number back to Twilio (it can't be recovered). */
export async function removeLine(receptionistId: string, release: boolean) {
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId } });
  if (release && r.businessNumberSid) await releaseNumber(r.businessNumberSid);
  await db.receptionist.update({ where: { id: r.id }, data: { businessNumber: null, businessNumberSid: null } });
}
