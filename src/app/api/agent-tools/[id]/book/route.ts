import { after, NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { book, type BookingInput } from "@/lib/agent-booking";
import { executeAccountResearch } from "@/lib/jobs";
import { builderBookingReceptionist } from "@/lib/live-builder";
import { recordActivity } from "@/lib/outreach";

// Research on a newly booked account runs after the agent has its answer.
export const maxDuration = 300;

// ElevenLabs webhook tool "book_appointment". Bearer = the receptionist's RAG token.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as BookingInput & { session_code?: string };
  try {
    // The demo builder books the follow-up into the rep's calendar and logs it on the prospect.
    const builder = r.agentType === "builder" ? await builderBookingReceptionist(r, body.session_code) : null;
    const { researchRunId, ...result } = await book(builder?.r ?? r, body);
    if (builder?.session && result.booked) {
      const s = builder.session;
      after(() => recordActivity({ accountId: s.accountId, type: "MEETING", direction: "OUTBOUND", source: "dialer", subject: `${r.bookingTitle}: ${result.label}`, body: `Booked by ${r.name} (demo builder) with ${s.repName}.`, createdById: s.repId }).then(() => undefined).catch((e) => console.error("builder booking activity", e)));
    }
    if (researchRunId) after(() => executeAccountResearch(researchRunId));
    return NextResponse.json(result);
  } catch (err) {
    console.error("booking failed", err);
    return NextResponse.json({ booked: false, message: "The booking didn't go through. Take the caller's preferred time and tell them the team will confirm shortly." });
  }
}
