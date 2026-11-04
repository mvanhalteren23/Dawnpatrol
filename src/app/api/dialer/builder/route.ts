import { after, NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { removeAgents, sessionForParent, startBuilder } from "@/lib/live-builder";

// The demo builder's first build (website draft + sync) runs after the response.
export const maxDuration = 300;

// Dialer buttons: POST { sid } adds the demo builder to the rep's live call; { sid, remove: true }
// takes the builder and any live demo off it (the rep and prospect stay connected).
export async function POST(req: Request) {
  const session = await apiSession("STAFF");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sid, remove } = (await req.json().catch(() => ({}))) as { sid?: string; remove?: boolean };
  if (!sid) return NextResponse.json({ ok: false, message: "No live call" }, { status: 400 });
  try {
    if (remove) {
      const s = await sessionForParent(sid);
      if (s && session.role !== "ADMIN" && s.repId !== session.sub) return NextResponse.json({ ok: false, message: "Not your call" }, { status: 403 });
      await removeAgents(sid);
      return NextResponse.json({ ok: true, message: "AI removed from the call." });
    }
    const res = await startBuilder(sid, session);
    if (res.background) after(res.background);
    return NextResponse.json({ ok: res.ok, message: res.message });
  } catch (err) {
    console.error("dialer builder", err);
    return NextResponse.json({ ok: false, message: `Couldn't add the builder: ${(err as Error).message}` }, { status: 500 });
  }
}
