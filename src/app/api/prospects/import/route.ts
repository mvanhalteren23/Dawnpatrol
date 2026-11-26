import { NextResponse } from "next/server";
import { sessionFromApiToken } from "@/lib/api-tokens";
import { importPack } from "@/lib/prospect-pack";
import { parsePack } from "@/lib/prospect-pack-rules";
import { appUrl } from "@/lib/app-url";

// The Claude prospecting skill sends its researched prospects here.
// Authorization: Bearer had_… (CRM → Settings → Claude prospecting skill).
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await sessionFromApiToken(req, "prospects");
  if (!session) return NextResponse.json({ error: "Unauthorized: the key is missing, wrong or revoked. Make a new one in CRM → Settings → Claude prospecting skill." }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 2_000_000) return NextResponse.json({ error: "Too large: send at most 50 prospects at a time." }, { status: 413 });
  let pack;
  try {
    pack = parsePack(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Body must be a prospect pack (JSON)." }, { status: 400 });
  }
  if (!pack.prospects.length) return NextResponse.json({ error: pack.problems.join(" ") || "No prospects in the pack." }, { status: 400 });
  const { runId, results } = await importPack(pack, session);
  const base = appUrl() || new URL(req.url).origin;
  return NextResponse.json({
    added: results.filter((r) => r.status === "added").length,
    alreadyInCrm: results.filter((r) => r.status === "exists").length,
    results: results.map((r) => ({ ...r, url: r.accountId ? `${base}/crm/accounts/${r.accountId}` : null })),
    problems: pack.problems,
    review: `${base}/crm/prospecting/${runId}`,
  });
}
