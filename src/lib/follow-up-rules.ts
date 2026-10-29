// Which follow-up to send, and how (pure; unit tested).
import type { Receptionist } from "@prisma/client";
import { dialableNumber } from "./twilio";

export type Channel = "sms" | "email";

export function followUpEnabled(r: Pick<Receptionist, "followUpOn">, kind: "booking" | "call"): boolean {
  return r.followUpOn === "both" || (kind === "booking" ? r.followUpOn === "bookings" : r.followUpOn === "calls");
}

/** Pick the channel: the receptionist's fixed choice, else the caller's; fall back to whichever contact we have. */
export function pickChannel(setting: string, preference: string | null | undefined, phone: string | null, email: string | null): Channel | null {
  const pref = (preference ?? "").toLowerCase();
  if (/^(none|no|neither|declined?)$/.test(pref)) return null; // the caller said no, whatever the setting
  const wanted: Channel | null = setting === "sms" ? "sms" : setting === "email" ? "email" : /mail/.test(pref) ? "email" : /text|sms/.test(pref) ? "sms" : null;
  if (wanted === "email") return email ? "email" : phone ? "sms" : null;
  if (wanted === "sms") return phone ? "sms" : email ? "email" : null;
  return null; // caller wasn't asked or didn't say
}

// --- Owner lead alerts and opt-outs --------------------------------------------------------

/** "" = off; "messages" = calls that need a call back; "leads" = those plus bookings and transfers. */
export type LeadAlertOn = "" | "messages" | "leads";

export function leadAlertWanted(setting: string, outcome: string): boolean {
  if (setting === "messages") return outcome === "MESSAGE_TAKEN" || outcome === "MISSED_OPPORTUNITY";
  if (setting === "leads") return ["MESSAGE_TAKEN", "MISSED_OPPORTUNITY", "BOOKED", "TRANSFERRED"].includes(outcome);
  return false;
}

const OUTCOME_WORDS: Record<string, string> = {
  MESSAGE_TAKEN: "needs a call back",
  MISSED_OPPORTUNITY: "hung up before finishing; worth a call back",
  BOOKED: "booked an appointment",
  TRANSFERRED: "was transferred to you",
};

/** The text the owner gets: who, what they need, the number, and how to mark it handled. */
export function ownerAlertText(o: { businessName: string; callerName: string | null; callerNumber: string | null; outcome: string; summary: string; canReply: boolean }): string {
  const who = o.callerName ?? o.callerNumber ?? "A caller";
  const summary = o.summary.replace(/\s+/g, " ").trim();
  const lines = [
    `${o.businessName}: ${who} ${OUTCOME_WORDS[o.outcome] ?? "called"}.`,
    summary ? (summary.length > 220 ? `${summary.slice(0, 217)}…` : summary) : null,
    o.callerNumber && o.callerName ? `Call back: ${o.callerNumber}` : null,
    o.canReply && o.outcome !== "BOOKED" && o.outcome !== "TRANSFERRED" ? "Reply 1 when handled." : null,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Carrier opt-out keywords (CTIA): the whole message, any case. */
export function isOptOut(body: string): boolean {
  return /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out|revoke)\s*[.!]?\s*$/i.test(body);
}

export function isOptIn(body: string): boolean {
  return /^\s*(start|unstop|yes)\s*[.!]?\s*$/i.test(body);
}

/** An owner marking their latest lead handled: "1", "done", "handled". */
export function isHandledReply(body: string): boolean {
  return /^\s*(1|done|handled|ok|got it)\s*[.!]?\s*$/i.test(body);
}

/** Read the LeadAlertFields form. Throws on a number we can't text. */
export function leadAlertFromForm(form: FormData): { leadAlertOn: string; leadAlertTo: string } {
  const on = String(form.get("leadAlertOn") ?? "");
  const raw = String(form.get("leadAlertTo") ?? "").split(/[,;\n]+/).map((n) => n.trim()).filter(Boolean);
  const numbers: string[] = [];
  for (const n of raw) {
    const e164 = dialableNumber(n);
    if (!e164) throw new Error(`"${n}" isn't a Canadian or US mobile number we can text`);
    if (!numbers.includes(e164)) numbers.push(e164);
  }
  if (numbers.length > 5) throw new Error("Up to 5 numbers can get lead texts");
  return { leadAlertOn: on === "messages" || on === "leads" ? on : "", leadAlertTo: numbers.join(", ") };
}
