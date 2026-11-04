import { NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { personalizationQuestions } from "@/lib/demo-builder";

// ElevenLabs webhook tool "get_personalization_questions" (the company's own receptionist only).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!r.bookingAddsToCrm) return NextResponse.json({ error: "Not available for this receptionist" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Parameters<typeof personalizationQuestions>[0];
  try {
    return NextResponse.json(await personalizationQuestions(body));
  } catch (err) {
    console.error("personalization questions failed", err);
    return NextResponse.json({ questions: [], message: "The questions aren't available right now. Tell the caller the team will go through their business with them on the demo, and wrap up." });
  }
}
