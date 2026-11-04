import { after, NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { builderTool } from "@/lib/live-builder";

// Sync and conference moves run after the agent has its answer.
export const maxDuration = 300;

// ElevenLabs webhook tools of the live demo builder: get_build_questions (questions),
// save_build_answers (answers), demo_status (status), connect_live_demo (live-demo), leave_call (leave).
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (r.agentType !== "builder") return NextResponse.json({ error: "Not available for this receptionist" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { session_code?: string; answers?: string };
  try {
    const { result, background } = await builderTool(action, String(body.session_code ?? ""), body);
    if (background) after(() => background().catch((e) => console.error(`builder ${action}`, e)));
    return NextResponse.json(result);
  } catch (err) {
    console.error(`builder tool ${action} failed`, err);
    return NextResponse.json({ message: "That didn't work. Apologise, say the team will follow up, and call leave_call." });
  }
}
