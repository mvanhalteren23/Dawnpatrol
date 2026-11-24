import { after, NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { isAssistantLine } from "@/lib/elevenlabs";
import { transferCall } from "@/lib/assistant";
import { redirectCall } from "@/lib/house-line";

// ElevenLabs webhook tool "transfer_call" (every live receptionist): put the live call through. Where it
// goes comes from the line's directory and routing rules (or, for an urgent caller, the transfer
// number), never from the agent. The call leaves the agent and rings that number with a
// "press 1 to answer" screen; if nobody takes it, the agent comes back on and takes a message.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAssistantLine(r)) return NextResponse.json({ message: "Putting callers through isn't available on this line. Take a message instead." });
  const body = (await req.json().catch(() => ({}))) as { call_sid?: string; urgent?: boolean | string };
  const callSid = String(body.call_sid ?? "");
  try {
    const res = await transferCall(r, callSid, body.urgent === true || body.urgent === "true");
    // Let the agent say its one line, then move the call.
    if (res.redirect) after(() => new Promise((ok) => setTimeout(ok, 2500)).then(() => redirectCall(callSid, res.redirect!)).catch((e) => console.error("transfer redirect", e)));
    return NextResponse.json({ message: res.message });
  } catch (err) {
    console.error("transfer failed", err);
    return NextResponse.json({ message: "The call couldn't be put through right now. Take a message instead, and say they'll get a call back." });
  }
}
