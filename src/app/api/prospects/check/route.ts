import { NextResponse } from "next/server";
import { sessionFromApiToken } from "@/lib/api-tokens";
import { knownBusinesses } from "@/lib/prospect-pack";

// Before researching, the skill asks which candidates are already in the CRM.
// POST { "businesses": [{ "name", "website", "phone", "city" }] } with Authorization: Bearer had_…
export async function POST(req: Request) {
  const session = await sessionFromApiToken(req, "prospects");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { businesses?: unknown } | null;
  const list = Array.isArray(body?.businesses) ? body.businesses : [];
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 300) : null);
  const items = list.filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object").map((b) => ({ name: str(b.name), website: str(b.website), phone: str(b.phone), city: str(b.city) }));
  return NextResponse.json({ results: await knownBusinesses(items) });
}
