import { NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { chunkItems, searchChunks } from "@/lib/rag";

// Retrieval endpoint. Register it in ElevenLabs as a webhook (server) tool, e.g. name
// "lookup_business_info", GET, query param `q` = "the caller's question", header
// Authorization: Bearer <token>. Also usable by any Claude workflow.
async function handle(req: Request, id: string, query: string, k: number) {
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!query.trim()) return NextResponse.json({ error: "Missing q" }, { status: 400 });
  const results = searchChunks(chunkItems(r.knowledge), query, Math.min(10, Math.max(1, k)));
  return NextResponse.json({
    business: r.businessName,
    query,
    results: results.map((c) => ({ title: c.title, category: c.category, text: c.text, score: Math.round(c.score * 100) / 100 })),
    answerHint: results.length ? undefined : "No matching knowledge. Tell the caller the team will confirm and take a message.",
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  return handle(req, id, sp.get("q") ?? "", Number(sp.get("k") ?? 4));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { q?: string; query?: string; k?: number };
  return handle(req, id, body.q ?? body.query ?? "", body.k ?? 4);
}
