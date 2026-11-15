import { NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { apiSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { finishRegistration, registrationOptions } from "@/lib/passkeys";

// Add a passkey to the signed-in CRM user. ?step=options, then ?step=verify with the browser's answer.
export async function POST(req: Request) {
  const session = await apiSession("STAFF");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const step = new URL(req.url).searchParams.get("step");
  if (step === "options") {
    const user = await db.user.findUniqueOrThrow({ where: { id: session.sub }, select: { id: true, email: true, name: true } });
    if ((await db.passkey.count({ where: { userId: user.id } })) >= 10) return NextResponse.json({ error: "You have 10 passkeys already. Remove one first." }, { status: 400 });
    return NextResponse.json(await registrationOptions(user), { headers: { "Cache-Control": "no-store" } });
  }
  if (step === "verify") {
    const body = (await req.json().catch(() => null)) as RegistrationResponseJSON | null;
    if (!body?.id) return NextResponse.json({ error: "Missing passkey" }, { status: 400 });
    const res = await finishRegistration(session.sub, body, req.headers.get("user-agent") ?? "");
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  }
  return NextResponse.json({ error: "Unknown step" }, { status: 400 });
}
