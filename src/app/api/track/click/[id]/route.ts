import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyLink } from "@/lib/tracking";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = req.nextUrl.searchParams.get("u") ?? "";
  const sig = req.nextUrl.searchParams.get("s") ?? "";
  if (!/^https?:\/\//.test(url) || !verifyLink(id, url, sig)) return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  await db.activity.updateMany({ where: { id }, data: { clickCount: { increment: 1 } } });
  return NextResponse.redirect(url, { status: 302 });
}
