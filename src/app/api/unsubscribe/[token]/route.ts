import { NextResponse } from "next/server";
import { readUnsubscribeToken } from "@/lib/unsubscribe-token";
import { suppress } from "@/lib/suppression";

// RFC 8058 one-click unsubscribe: Gmail's and Outlook's own "Unsubscribe" button POSTs here.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const email = readUnsubscribeToken((await params).token);
  if (!email) return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  await suppress(email, "one-click");
  return NextResponse.json({ ok: true });
}
