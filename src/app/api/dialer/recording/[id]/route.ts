import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchRecording } from "@/lib/dialer";

// Play a dialer call recording in the CRM (admins only; Twilio recordings need account auth).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiSession("STAFF");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const a = await db.activity.findUnique({ where: { id }, select: { recordingSid: true } });
  if (!a?.recordingSid) return NextResponse.json({ error: "No recording" }, { status: 404 });
  const res = await fetchRecording(a.recordingSid);
  if (!res.ok || !res.body) return NextResponse.json({ error: `Twilio ${res.status}` }, { status: 502 });
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
}
