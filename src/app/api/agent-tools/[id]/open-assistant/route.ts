import { after, NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { openAssistantForClient, redirectCall } from "@/lib/house-line";

// ElevenLabs webhook tool "open_assistant" (the company receptionist only): an Assistant-tier client
// calling from one of their own owner numbers is put through to their own assistant, in owner mode.
// The app checks the live call's number; Grace's judgement is never trusted for that.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!r.bookingAddsToCrm) return NextResponse.json({ error: "Not available for this receptionist" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { call_sid?: string };
  const callSid = String(body.call_sid ?? "");
  try {
    const res = await openAssistantForClient(callSid);
    if (res.redirect) after(() => new Promise((ok) => setTimeout(ok, 1500)).then(() => redirectCall(callSid, res.redirect!)).catch((e) => console.error("open assistant redirect", e)));
    return NextResponse.json({ message: res.message });
  } catch (err) {
    console.error("open assistant failed", err);
    return NextResponse.json({ message: "That didn't work. Offer to take their request instead, or suggest calling their own business line from their phone." });
  }
}
