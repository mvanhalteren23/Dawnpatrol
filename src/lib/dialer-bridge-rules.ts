// "Call my phone" dialer (pure; unit tested).

export type BridgeState = "CALLING" | "READY" | "DIALING" | "ENDED";

export type PendingDial = { key: string; accountId: string; contactId: string | null; to: string; vm: string | null; vmId: string };

/** How long the rep's phone may sit idle between calls before we hang up (each wait is 5 minutes). */
export const WAIT_SECONDS = 300;
export const MAX_IDLE_WAITS = 3;

/** One key per prospect call: the call's activity is "dialer:<key>" (the rep's own call spans many). */
export function legKey(bridgeId: string, n: number): string {
  return `br${n}_${bridgeId}`;
}

export function bridgeIdFromKey(key: string): string | null {
  return /^br\d+_([a-z0-9]{10,40})$/.exec(key)?.[1] ?? null;
}

const FINAL = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);

export function isFinalLegStatus(status: string | null | undefined): boolean {
  return FINAL.has(status ?? "");
}

/** What the app shows for the prospect's leg. */
export function legPhase(status: string | null | undefined): "connecting" | "ringing" | "live" | "ended" {
  if (status === "ringing") return "ringing";
  if (status === "in-progress" || status === "answered") return "live";
  if (isFinalLegStatus(status)) return "ended";
  return "connecting";
}

/** The rep's call ended: why, in plain words. */
export function endedReason(callStatus: string, answered: boolean): string {
  if (callStatus === "busy") return "Your phone was busy.";
  if (callStatus === "no-answer") return "Your phone wasn't answered.";
  if (callStatus === "failed") return "Couldn't call your phone. Check your mobile number in Settings.";
  if (callStatus === "canceled") return "The call to your phone was cancelled.";
  return answered ? "Your phone hung up." : "The call to your phone ended before you pressed 1.";
}

export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ···-${d.slice(6)}` : "your phone";
}

export function parsePending(raw: string | null | undefined): PendingDial | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as PendingDial;
    return p && typeof p.key === "string" && typeof p.accountId === "string" && typeof p.to === "string" ? p : null;
  } catch {
    return null;
  }
}
