import "server-only";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { registerTwilioCall } from "./elevenlabs";
import { slotRules } from "./agent-booking";
import { isOpenAt } from "./booking";
import { attachNumber, buyNumber, cleanDigits, findLocalNumber, releaseNumber, say, toE164, twiml } from "./twilio";
import { appBase } from "./twilio-request";

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

/** TwiML that hands the call to the receptionist's ElevenLabs agent. */
export async function toAgent(r: Receptionist, from: string, to: string): Promise<string> {
  if (!r.elevenLabsAgentId) return twiml(`${say(`Sorry, ${r.businessName} can't take your call right now. Please call back shortly.`)}<Hangup/>`);
  try {
    return await registerTwilioCall(r.elevenLabsAgentId, from, to);
  } catch (err) {
    console.error("business line: register-call failed", err);
    return twiml(`${say(`Sorry, ${r.businessName} can't take your call right now. Please call back shortly.`)}<Hangup/>`);
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
