import "server-only";
import type { Receptionist } from "@prisma/client";
import { getSetting, setSetting } from "./settings";
import { appUrl } from "./app-url";
import { withAfterAgent, numbersMissingFallback } from "./agent-fallback-rules";

// Safety nets for inbound calls. A caller should never reach silence or a dead line:
//  - the agent can't be reached, or drops the call in its first seconds → voicemail, transcribed
//    and sent to the owner as a lead, and the team is alerted;
//  - the CRM itself is unreachable → Twilio's backup address (/api/voice/fallback) takes a message.

type Line = Pick<Receptionist, "id" | "businessName">;

/** The agent hand-off, with the "if it drops" check attached. */
export function guardedHandoff(r: Line, agentTwiml: string): string {
  return withAfterAgent(agentTwiml, `${appUrl()}/api/voice/after-agent?r=${encodeURIComponent(r.id)}&t=${Date.now()}`);
}

/** Voicemail in place of the agent, and a (throttled) alert to the team. */
export async function agentUnavailable(r: Line, reason: string): Promise<string> {
  const { voicemailTwiml } = await import("./call-guard");
  await alertOnce(`agent.down.${r.id}`, 30, `Calls to ${r.businessName} are going to voicemail`, `The voice agent couldn't take a call (${reason.slice(0, 160)}). Callers can leave a message, which is sent to the owner. Check ElevenLabs credits and status: ${appUrl()}/crm/launch`);
  return voicemailTwiml(r, "agent");
}

/** Text and email the team, at most once per `minutes` for the same problem. */
export async function alertOnce(key: string, minutes: number, subject: string, body: string): Promise<boolean> {
  try {
    const k = `alerted.${key}`;
    const last = Number((await getSetting(k)) ?? 0);
    if (Date.now() - last < minutes * 60_000) return false;
    await setSetting(k, String(Date.now()));
    const { alertTeam } = await import("./call-guard");
    await alertTeam(subject, body);
    return true;
  } catch (err) {
    console.warn("alertOnce failed", err);
    return false;
  }
}

export type TwilioNumberRow = { sid: string; phone_number: string; voice_url?: string | null; voice_fallback_url?: string | null };

export async function crmNumbers(): Promise<TwilioNumberRow[]> {
  const { twilioApi } = await import("./twilio");
  return (await twilioApi<{ incoming_phone_numbers: TwilioNumberRow[] }>("/IncomingPhoneNumbers.json?PageSize=200")).incoming_phone_numbers ?? [];
}

/** How many of our numbers answer through the CRM, and how many lack the backup address. */
export async function fallbackCoverage(): Promise<{ total: number; missing: number }> {
  const base = appUrl().replace(/\/$/, "");
  const all = await crmNumbers();
  return { total: all.filter((n) => (n.voice_url ?? "").startsWith(`${base}/api/voice/`)).length, missing: numbersMissingFallback(all, base).length };
}

/** Set the backup address on every number that answers through the CRM. */
export async function applyFallbackUrls(): Promise<number> {
  const { twilioApi } = await import("./twilio");
  const base = appUrl().replace(/\/$/, "");
  const missing = numbersMissingFallback(await crmNumbers(), base);
  for (const sid of missing) await twilioApi(`/IncomingPhoneNumbers/${sid}.json`, { form: { VoiceFallbackUrl: `${base}/api/voice/fallback`, VoiceFallbackMethod: "POST" } });
  return missing.length;
}
