import { NextResponse } from "next/server";
import { checkinStatus } from "@/lib/owner-checkin";
import { twilioParams } from "@/lib/twilio-request";

// How the check-in call ended: not reached is tried again the next day, then sent by text.
export async function POST(req: Request) {
  const params = await twilioParams(req);
  if (params instanceof Response) return params;
  const id = new URL(req.url).searchParams.get("c");
  if (id) await checkinStatus(id, params).catch((e) => console.error("check-in status", e));
  return new NextResponse(null, { status: 204 });
}
