import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { dialerToken } from "@/lib/dialer";

// Twilio Voice access token for the browser dialer (admins only).
export async function GET() {
  const session = await apiSession();
  if (session?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ token: await dialerToken(session.sub) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
