import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canAccessAudit } from "@/lib/access";
import { fetchConversationAudio } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";

// Streams an audit call's recording from ElevenLabs to the team (never to the public share page).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const call = await db.auditCall.findUnique({ where: { id }, select: { auditId: true, conversationId: true } });
  if (!call?.conversationId || !(await canAccessAudit(session, call.auditId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const upstream = await fetchConversationAudio(call.conversationId, req.headers.get("range")).catch((err: Error) => {
    console.warn("audit recording fetch failed", err);
    return undefined;
  });
  if (upstream === undefined) return NextResponse.json({ error: "Recording unavailable" }, { status: 502 });
  if (upstream === null || !upstream.body) return NextResponse.json({ error: "No recording for this call" }, { status: 404 });
  const headers = new Headers({ "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "private, max-age=3600" });
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
