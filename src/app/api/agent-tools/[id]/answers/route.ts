import { after, NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { savePersonalizationAnswers } from "@/lib/demo-builder";

// Building a new demo agent (website draft + sync) runs after the agent has its answer.
export const maxDuration = 300;

// ElevenLabs webhook tool "save_personalization_answers" (the company's own receptionist only).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!r.bookingAddsToCrm) return NextResponse.json({ error: "Not available for this receptionist" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Parameters<typeof savePersonalizationAnswers>[1];
  try {
    const { result, background } = await savePersonalizationAnswers(r, body);
    if (background) after(background);
    return NextResponse.json(result);
  } catch (err) {
    console.error("saving personalization answers failed", err);
    return NextResponse.json({ saved: false, message: "The answers didn't save. Tell the caller the team will go over them on the demo, and wrap up." });
  }
}
