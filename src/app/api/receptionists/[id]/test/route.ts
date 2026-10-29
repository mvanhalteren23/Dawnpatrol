import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiSession } from "@/lib/auth";
import { canAccessReceptionist } from "@/lib/access";
import { buildReceptionistPrompt, compileKnowledgeBase } from "@/lib/rag";
import { buildFollowupPrompt } from "@/lib/followup-rules";
import { receptionistReply } from "@/lib/ai";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await canAccessReceptionist(await apiSession(), id))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json()) as { messages?: { role: string; content: string }[] };
  const messages = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-30)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 4000) }));
  if (!messages.length || messages[0]!.role !== "user") return NextResponse.json({ error: "Start with a caller message" }, { status: 400 });
  const r = await db.receptionist.findUniqueOrThrow({ where: { id }, include: { knowledge: true } });
  try {
    // The test chat has no calendar tools, so it uses the collect-preferred-times flow.
    // Follow-up agents are tested against a sample website lead.
    const prompt = r.agentType === "followup"
      ? buildFollowupPrompt({ ...r, bookingEnabled: false })
          .replaceAll("{{lead_name}}", "Dana Lee (sample lead)")
          .replaceAll("{{lead_request}}", "Sample request: I'd like a quote. Please call me.")
      : buildReceptionistPrompt({ ...r, bookingEnabled: false });
    const reply = await receptionistReply(prompt, compileKnowledgeBase(r.knowledge, r.businessName), messages);
    return NextResponse.json({ reply });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
