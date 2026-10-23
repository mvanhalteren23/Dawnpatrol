import { after, NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { book, type BookingInput } from "@/lib/agent-booking";
import { executeAccountResearch } from "@/lib/jobs";

// Research on a newly booked account runs after the agent has its answer.
export const maxDuration = 300;

// ElevenLabs webhook tool "book_appointment". Bearer = the receptionist's RAG token.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as BookingInput;
  try {
    const { researchRunId, ...result } = await book(r, body);
    if (researchRunId) after(() => executeAccountResearch(researchRunId));
    return NextResponse.json(result);
  } catch (err) {
    console.error("booking failed", err);
    return NextResponse.json({ booked: false, message: "The booking didn't go through. Take the caller's preferred time and tell them the team will confirm shortly." });
  }
}
