import { NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { isAssistantLine } from "@/lib/elevenlabs";
import { ownerCaller, ownerLiveCaller, ownerMessages } from "@/lib/owner-mode";

// ElevenLabs webhook tool "owner_messages": today's calls and who's waiting for a call back, for
// the owner only (the live call's number is checked).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAssistantLine(r)) return NextResponse.json({ error: "Not available for this receptionist" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { call_sid?: string };
  const from = await ownerLiveCaller(r, String(body.call_sid ?? ""));
  if (!from || !(await ownerCaller(r, from))) return NextResponse.json({ message: "Messages are only read to the owner on their own phone." });
  return NextResponse.json({ message: `Read this to the owner briefly: ${await ownerMessages(r)}` });
}
