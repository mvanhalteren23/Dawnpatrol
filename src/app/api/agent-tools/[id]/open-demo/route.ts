import { after, NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { openDemoForTeam, redirectCall } from "@/lib/house-line";

// ElevenLabs webhook tool "open_demo" (the company receptionist only): a team member, recognised
// by the mobile on their login, asks for the demo menu or a demo. The app checks the live call.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!r.bookingAddsToCrm) return NextResponse.json({ error: "Not available for this receptionist" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { demo?: string; call_sid?: string };
  const callSid = String(body.call_sid ?? "");
  try {
    const res = await openDemoForTeam(callSid, String(body.demo ?? "").slice(0, 200));
    if (res.redirect) after(() => new Promise((ok) => setTimeout(ok, 1500)).then(() => redirectCall(callSid, res.redirect!)).catch((e) => console.error("open demo redirect", e)));
    return NextResponse.json({ message: res.message });
  } catch (err) {
    console.error("open demo failed", err);
    return NextResponse.json({ message: "That didn't work. Offer to try again." });
  }
}
