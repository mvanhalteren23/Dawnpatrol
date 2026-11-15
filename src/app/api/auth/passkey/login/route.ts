import { NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { issueSession } from "@/lib/auth";
import { finishLogin, loginOptions } from "@/lib/passkeys";
import { landingPath } from "@/lib/login-rules";

// Sign in with a passkey (fingerprint / face / screen lock). ?step=options, then ?step=verify.
// A passkey counts as both sign-in steps, so no authenticator code is asked for.
export async function POST(req: Request) {
  const step = new URL(req.url).searchParams.get("step");
  if (step === "options") return NextResponse.json(await loginOptions(), { headers: { "Cache-Control": "no-store" } });
  if (step === "verify") {
    const body = (await req.json().catch(() => null)) as { response?: AuthenticationResponseJSON; next?: string } | null;
    if (!body?.response?.id) return NextResponse.json({ error: "Missing passkey" }, { status: 400 });
    const res = await finishLogin(body.response);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 401 });
    const session = await issueSession(res.user);
    return NextResponse.json({ ok: true, redirect: landingPath(session.role, typeof body.next === "string" ? body.next : "") });
  }
  return NextResponse.json({ error: "Unknown step" }, { status: 400 });
}
