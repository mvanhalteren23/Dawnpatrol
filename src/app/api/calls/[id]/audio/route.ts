import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canAccessReceptionist } from "@/lib/access";
import { fetchConversationAudio } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";

// Streams a call recording from ElevenLabs to a signed-in admin, or to the client who owns the call.
// The ElevenLabs API key never reaches the browser.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const call = await db.callLog.findUnique({ where: { id }, select: { externalId: true, receptionistId: true } });
  if (!call || !(await canAccessReceptionist(session, call.receptionistId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const upstream = await fetchConversationAudio(call.externalId, req.headers.get("range")).catch((err: Error) => {
    console.warn("recording fetch failed", err);
    return undefined;
  });
  if (upstream === undefined) return NextResponse.json({ error: "Recording unavailable" }, { status: 502 });
  if (upstream === null || !upstream.body) return NextResponse.json({ error: "No recording for this call" }, { status: 404 });

  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": `inline; filename="call-${id}.mp3"`,
  });
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
