import { db } from "@/lib/db";
import { screenPrompt } from "@/lib/twilio";
import { appBase, twilioParams, xml } from "@/lib/twilio-request";

// Plays to the owner when their cell picks up. Voicemail can't press 1, so it never "answers".
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const id = new URL(req.url).searchParams.get("r") ?? "";
  const r = await db.receptionist.findUnique({ where: { id }, select: { businessName: true } });
  return xml(screenPrompt(r?.businessName ?? "Business", `${appBase()}/api/voice/business/accept?r=${id}`));
}
