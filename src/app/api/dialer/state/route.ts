import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { db } from "@/lib/db";

// Live state of a dialer call (answering-machine result, outcome), polled by the auto-dialer.
export async function GET(req: Request) {
  const session = await apiSession();
  if (session?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sid = new URL(req.url).searchParams.get("sid");
  if (!sid) return NextResponse.json({});
  const a = await db.activity.findUnique({ where: { externalId: `dialer:${sid}` }, select: { answeredBy: true, outcome: true, subject: true } });
  return NextResponse.json(a ?? {}, { headers: { "Cache-Control": "no-store" } });
}
