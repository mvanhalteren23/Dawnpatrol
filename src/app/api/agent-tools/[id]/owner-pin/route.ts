import { NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { isClientInbound } from "@/lib/elevenlabs";
import { ownerPinOnCall } from "@/lib/owner-mode";

// ElevenLabs webhook tool "owner_pin" (Assistant tier): the digits the owner keyed in, checked
// against their PIN before a bigger change. The app checks the live call is from an owner number;
// the PIN is never in the agent's prompt.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isClientInbound(r)) return NextResponse.json({ error: "Not available for this receptionist" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { digits?: string; call_sid?: string };
  try {
    const message = await ownerPinOnCall(r, String(body.call_sid ?? ""), String(body.digits ?? "").slice(0, 40));
    return NextResponse.json({ message });
  } catch (err) {
    console.error("owner pin failed", err);
    return NextResponse.json({ message: "The PIN couldn't be checked right now. Tell the owner to try again shortly, or to make the change in their portal." });
  }
}
