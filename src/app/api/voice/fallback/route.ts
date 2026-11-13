import { escapeXml, say, twiml } from "@/lib/twilio";
import { twilioParams, xml } from "@/lib/twilio-request";
import { appUrl } from "@/lib/app-url";

// Twilio's backup address for every number: used when the main voice address errors or times
// out (e.g. the database is unreachable). Works without the database: takes a message. If the
// database is up, the message is transcribed and sent to the owner like any voicemail.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  let name = "";
  let callbacks = "";
  try {
    const { db } = await import("@/lib/db");
    const { houseReceptionist } = await import("@/lib/house-line");
    const r = (await db.receptionist.findUnique({ where: { businessNumber: params.To ?? "" }, select: { id: true, businessName: true } })) ?? (params.To && params.To === process.env.TWILIO_DEMO_NUMBER ? await houseReceptionist() : null);
    if (r) {
      name = r.businessName;
      const base = `${appUrl()}/api/voice/guard?r=${encodeURIComponent(r.id)}&why=agent`;
      callbacks = ` transcribe="true" transcribeCallback="${escapeXml(`${base}&step=transcript`)}" action="${escapeXml(`${base}&step=done`)}" method="POST"`;
      const { alertOnce } = await import("@/lib/agent-fallback");
      await alertOnce(`fallback.${r.id}`, 30, `Backup answering used for ${r.businessName}`, `A call reached Twilio's backup address (error ${params.ErrorCode ?? "unknown"}), so the main call handler failed. The caller was offered voicemail.`);
    }
  } catch (err) {
    console.error("voice fallback: database unavailable", err);
  }
  return xml(twiml(`${say(`Thanks for calling${name ? ` ${name}` : ""}. We can't take your call right now. Please leave your name, number and what you need after the tone, and we'll call you back.`)}<Record maxLength="120" playBeep="true" timeout="8"${callbacks}/><Hangup/>`));
}
