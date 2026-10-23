import { NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { availability } from "@/lib/agent-booking";

// ElevenLabs webhook tool "get_available_times". Bearer = the receptionist's RAG token.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { preferred_date?: string; time_of_day?: string };
  try {
    return NextResponse.json(await availability(r, body));
  } catch (err) {
    console.error("availability failed", err);
    return NextResponse.json({ available: false, message: "The calendar couldn't be checked. Collect two preferred days and times and tell the caller the team will confirm." });
  }
}
