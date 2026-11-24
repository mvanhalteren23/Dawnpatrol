import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { cachedHouseReceptionist } from "@/lib/answer-path";

export const preferredRegion = "iad1";
export const dynamic = "force-dynamic";

// Warm-up ping (infra/cloudflare/warm-worker): keeps a server instance running and the database
// awake during business hours, so the first call after a quiet spell doesn't wait for either to
// start. Does one tiny query and fills Grace's cache. If WARM_TOKEN is set, the ping must send it.
export async function GET(req: Request) {
  const want = process.env.WARM_TOKEN;
  if (want) {
    const got = Buffer.from(req.headers.get("x-warm") ?? "");
    const ok = got.length === Buffer.byteLength(want) && timingSafeEqual(got, Buffer.from(want));
    if (!ok) return new Response("Forbidden", { status: 403 });
  }
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    await cachedHouseReceptionist();
    return Response.json({ ok: true, ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.warn("warm ping: database not reachable", err);
    return Response.json({ ok: false, ms: Date.now() - started }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
