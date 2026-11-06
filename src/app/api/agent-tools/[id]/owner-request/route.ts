import { NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { isClientInbound } from "@/lib/elevenlabs";
import { ownerRequestOnCall } from "@/lib/owner-mode";

export const maxDuration = 60;

// ElevenLabs webhook tool "owner_request": the owner, on their own line, changes closures, hours,
// calendar blocks or what the agent says. The app checks the live call is from an owner number.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isClientInbound(r)) return NextResponse.json({ error: "Not available for this receptionist" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { request?: string; confirmed?: boolean | string; call_sid?: string };
  try {
    const message = await ownerRequestOnCall(r, String(body.call_sid ?? ""), String(body.request ?? "").slice(0, 1000), body.confirmed === true || body.confirmed === "true");
    return NextResponse.json({ message });
  } catch (err) {
    console.error("owner request failed", err);
    return NextResponse.json({ message: "That couldn't be done right now. Tell the owner, and suggest texting the change to this number or using their portal." });
  }
}
