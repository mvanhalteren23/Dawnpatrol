import { NextResponse } from "next/server";
import { authorizeRag } from "@/lib/rag-auth";
import { activeItems, buildReceptionistPrompt, compileByCategory, compileKnowledgeBase } from "@/lib/rag";

// Full knowledge-base export: markdown (for Claude Projects / prompts) or JSON (for pipelines).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await authorizeRag(req, id);
  if (!r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const format = new URL(req.url).searchParams.get("format") ?? "markdown";
  if (format === "json") {
    return NextResponse.json({
      receptionist: { id: r.id, name: r.name, businessName: r.businessName, elevenLabsAgentId: r.elevenLabsAgentId },
      systemPrompt: buildReceptionistPrompt(r),
      documents: compileByCategory(r.knowledge, r.businessName),
      items: activeItems(r.knowledge).map((i) => ({ id: i.id, category: i.category, title: i.title, content: i.content, tags: i.tags, updatedAt: i.updatedAt })),
    });
  }
  return new Response(compileKnowledgeBase(r.knowledge, r.businessName), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
