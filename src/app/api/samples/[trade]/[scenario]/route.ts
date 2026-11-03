import { NextResponse } from "next/server";
import { sampleAudio } from "@/lib/sample-calls";
import { TRADE_KEYS, type Scenario, type TradeKey } from "@/lib/site-content";

// A website sample call recording (public).
export async function GET(_req: Request, { params }: { params: Promise<{ trade: string; scenario: string }> }) {
  const { trade, scenario } = await params;
  if (!TRADE_KEYS.includes(trade as TradeKey) || (scenario !== "customer" && scenario !== "supplier")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const audio = await sampleAudio(trade as TradeKey, scenario as Scenario);
  if (!audio) return NextResponse.json({ error: "No recording yet" }, { status: 404 });
  return new Response(new Uint8Array(audio.data), {
    headers: { "Content-Type": audio.mime, "Content-Length": String(audio.data.length), "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  });
}
