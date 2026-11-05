import { after, NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { handleKeypad, redirectCall } from "@/lib/house-line";

// ElevenLabs webhook tool "keypad_entry" (the company receptionist only). The app checks the
// digits: the owner's code opens the demo menu, a demo extension opens that demo. The code is never
// in the agent's prompt, so a caller can't talk their way in.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!r.bookingAddsToCrm) return NextResponse.json({ error: "Not available for this receptionist" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { digits?: string; call_sid?: string };
  const callSid = String(body.call_sid ?? "");
  try {
    const res = await handleKeypad(callSid, String(body.digits ?? ""));
    // Let the agent say its short line, then move the call.
    if (res.redirect) after(() => new Promise((ok) => setTimeout(ok, 1500)).then(() => redirectCall(callSid, res.redirect!)).catch((e) => console.error("keypad redirect", e)));
    return NextResponse.json({ message: res.message });
  } catch (err) {
    console.error("keypad failed", err);
    return NextResponse.json({ message: "Carry on helping the caller." });
  }
}
