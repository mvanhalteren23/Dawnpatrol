import { NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { takeClientMessage } from "@/lib/demo-builder";

// ElevenLabs webhook tool "take_client_message" (the company's own receptionist only).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!r.bookingAddsToCrm) return NextResponse.json({ error: "Not available for this receptionist" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Parameters<typeof takeClientMessage>[1];
  try {
    return NextResponse.json(await takeClientMessage(r, body));
  } catch (err) {
    console.error("client message failed", err);
    return NextResponse.json({ sent: false, message: "The message didn't go through. Apologise, and ask them to email the team or call back later." });
  }
}
