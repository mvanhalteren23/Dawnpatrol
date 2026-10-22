import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { createPortalSession } from "@/lib/billing";

export async function POST(req: Request) {
  const session = await apiSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  const form = await req.formData();
  const accountId = session.role === "ADMIN" ? String(form.get("accountId") ?? "") : session.accountId;
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 400 });
  const url = await createPortalSession(accountId, "/portal/billing");
  return NextResponse.redirect(url, { status: 303 });
}
