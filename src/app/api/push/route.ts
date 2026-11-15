import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { pushToUsers, vapidKeys } from "@/lib/push";

// Phone notifications for the signed-in CRM user.
// GET: the public key to subscribe with. POST: save this device. DELETE: forget this device.
// PUT: send a test notification to all of your devices.

export async function GET() {
  const session = await apiSession("STAFF");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { publicKey } = await vapidKeys();
  return NextResponse.json({ publicKey }, { headers: { "Cache-Control": "no-store" } });
}

type Sub = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

function validEndpoint(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 2000) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const session = await apiSession("STAFF");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { subscription?: Sub; device?: unknown };
  const s = body.subscription;
  const p256dh = s?.keys?.p256dh;
  const auth = s?.keys?.auth;
  if (!s || !validEndpoint(s.endpoint) || typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 100) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }
  const device = typeof body.device === "string" ? body.device.slice(0, 60) : "";
  // One device, one owner: signing in as someone else on the same phone moves it to them.
  await db.pushSubscription.upsert({
    where: { endpoint: s.endpoint },
    create: { userId: session.sub, endpoint: s.endpoint, p256dh, auth, device },
    update: { userId: session.sub, p256dh, auth, device },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await apiSession("STAFF");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: unknown };
  if (typeof endpoint === "string") await db.pushSubscription.deleteMany({ where: { endpoint, userId: session.sub } });
  return NextResponse.json({ ok: true });
}

export async function PUT() {
  const session = await apiSession("STAFF");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // A test goes through whatever the quiet-hours setting is, so you can check it works.
  const sent = await pushToUsers([session.sub], { category: "lines", urgent: true, title: "Notifications are on", body: "This is how Head Above alerts will look on this device.", url: "/crm/today", tag: "test" }, new Date(), { ignorePrefs: true });
  return NextResponse.json({ ok: sent > 0, sent });
}
