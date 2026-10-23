// Which follow-up to send, and how (pure; unit tested).
import type { Receptionist } from "@prisma/client";

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
