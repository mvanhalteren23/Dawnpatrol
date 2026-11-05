import { NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { saveCheckinAnswers } from "@/lib/owner-checkin";

// Saving answers syncs the client's receptionist to ElevenLabs.
export const maxDuration = 60;

// ElevenLabs webhook tool "save_checkin_answers" (the owner check-in agent only).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (r.agentType !== "checkin") return NextResponse.json({ error: "Not available for this receptionist" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { checkin_id?: string; answers?: string };
  try {
    return NextResponse.json(await saveCheckinAnswers(String(body.checkin_id ?? ""), String(body.answers ?? "")));
  } catch (err) {
    console.error("save check-in answers failed", err);
    return NextResponse.json({ saved: false, message: "The answers didn't save. Thank them; the questions will be sent by text." });
  }
}
