// Keeping a client's existing business number: forward it to their receptionist line, or move
// (port) it to Twilio. Pure; unit tested.

export type KeepMethod = "" | "forward_no_answer" | "forward_all" | "port";

export const KEEP_METHODS: { value: KeepMethod; label: string; summary: string }[] = [
  {
    value: "forward_no_answer",
    label: "Forward missed calls (recommended)",
    summary: "Their phone rings as it does today. Calls they don't pick up, or get while on another call, go to the receptionist instead of voicemail.",
  },
  {
    value: "forward_all",
    label: "Forward every call",
    summary: "Every call goes to the receptionist line first, which can ring their cell before the receptionist answers.",
  },
  {
    value: "port",
    label: "Move the number to us (port)",
    summary: "The number itself moves to the receptionist line, so calls and texts both arrive. Takes 1–3 weeks; their current phone service for that number ends.",
  },
];

export type CarrierKind = "mobile" | "landline" | "voip";

export const CARRIERS: { value: string; label: string; kind: CarrierKind }[] = [
  { value: "rogers", label: "Rogers / Fido / Chatr (mobile)", kind: "mobile" },
  { value: "bell", label: "Bell / Virgin Plus / Lucky (mobile)", kind: "mobile" },
  { value: "telus", label: "Telus / Koodo / Public (mobile)", kind: "mobile" },
  { value: "freedom", label: "Freedom Mobile", kind: "mobile" },
  { value: "other_mobile", label: "Other mobile carrier", kind: "mobile" },
  { value: "landline", label: "Office landline (Bell, Telus, Shaw, Rogers…)", kind: "landline" },
  { value: "voip", label: "Business phone app (RingCentral, Ooma, Google Voice, Teams…)", kind: "voip" },
];

export function carrierKind(carrier: string | null | undefined): CarrierKind | null {
  return CARRIERS.find((c) => c.value === carrier)?.kind ?? null;
}

const digits = (e164: string) => e164.replace(/\D/g, "").slice(-11).replace(/^(?!1)/, "1"); // 1XXXXXXXXXX

export type Step = { text: string; code?: string };

/**
 * What the client does on their phone to forward their number to `target` (the receptionist
 * line, E.164). Mobile carriers in Canada all accept the standard GSM forwarding codes.
 */
export function forwardingSteps(carrier: string | null | undefined, method: KeepMethod, target: string, ringSeconds = 20): Step[] {
  const kind = carrierKind(carrier);
  const n = digits(target);
  const secs = Math.min(30, Math.max(5, Math.round(ringSeconds / 5) * 5)); // carriers accept 5–30 in steps of 5
  if (method === "port" || !method) return [];
  if (kind === "mobile") {
    return method === "forward_all"
      ? [
          { text: "On the phone with the business number, dial this and press Call. You'll hear or see a confirmation.", code: `**21*${n}#` },
          { text: "To stop forwarding later, dial:", code: "##21#" },
        ]
      : [
          { text: `On the phone with the business number, dial this and press Call. It sends calls you don't answer within ${secs} seconds, calls while you're busy, and calls when the phone is off to the receptionist.`, code: `**004*${n}**${secs}#` },
          { text: "To stop forwarding later, dial:", code: "##004#" },
          { text: "If the carrier answers with an error, set the three separately:", code: `**61*${n}**${secs}#   **67*${n}#   **62*${n}#` },
        ];
  }
  if (kind === "landline") {
    return method === "forward_all"
      ? [
          { text: "Pick up the office phone, dial this, and wait for the confirmation tone (or for the receptionist to answer, then hang up).", code: `*72 ${n}` },
          { text: "To stop forwarding later, dial:", code: "*73" },
        ]
      : [
          { text: `Call the phone company's business support and ask for "call forward on no answer and busy" to ${formatNumber(target)}, after ${Math.max(3, Math.round(secs / 6))} rings. Landline codes for this differ by provider, so asking is the reliable way.` },
          { text: "If they only offer forwarding of every call, it's dialled like this:", code: `*72 ${n}` },
        ];
  }
  if (kind === "voip") {
    return [
      {
        text: method === "forward_all"
          ? `In the phone app's admin settings, set the business number to forward every call to ${formatNumber(target)}.`
          : `In the phone app's admin settings, set calls that aren't answered (and the voicemail option) to forward to ${formatNumber(target)}.`,
      },
      { text: "Look for “call handling”, “call forwarding” or “answering rules”. Most apps let you set this per business hours too." },
    ];
  }
  return [{ text: "Pick the phone company above to see the exact steps." }];
}

export function formatNumber(e164: string): string {
  const d = digits(e164).slice(1);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

export const PORT_STATUSES: { value: string; label: string }[] = [
  { value: "", label: "Not started" },
  { value: "gathering", label: "Gathering details from the client" },
  { value: "submitted", label: "Submitted to Twilio" },
  { value: "scheduled", label: "Port date scheduled" },
  { value: "done", label: "Done: number moved" },
];

/** What's needed from the client to move their number (Twilio port-in, Canada). */
export const PORT_CHECKLIST = [
  "A recent bill from the current phone company (PDF), showing the account holder's name and service address",
  "The account number with that company, and for a mobile number the transfer PIN (ask the carrier, or dial *611)",
  "The authorized person's name exactly as it appears on the account",
  "Whether the number is the only number on the account: porting it may close that account, so move other numbers first",
  "Keep the current service active until the move is complete: cancelling early can lose the number",
];

export const LOOP_MESSAGE =
  "That would bounce calls back and forth: the business number forwards to the receptionist line, which would ring the same number first. Ring a different cell first, or set ringing to \"never\".";

/**
 * Settings that would bounce a call back and forth: the business number forwards to the
 * receptionist line, which rings that same number first, which forwards it again.
 */
export function forwardingLoop(o: { method: KeepMethod; existingNumber: string | null; ringFirstNumber: string | null; ringMode: string }): boolean {
  if ((o.method !== "forward_all" && o.method !== "forward_no_answer") || !o.existingNumber || !o.ringFirstNumber || o.ringMode === "never") return false;
  return digits(o.existingNumber) === digits(o.ringFirstNumber);
}
