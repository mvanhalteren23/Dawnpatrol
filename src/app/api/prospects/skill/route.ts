import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/api-tokens";
import { appUrl } from "@/lib/app-url";
import { makeZip } from "@/lib/zip";

// Download the Claude prospecting skill (claude-skill/head-above-prospecting) as a .zip to upload
// to Claude. POST with a key just made in Settings builds it in; GET gives a copy without a key.
const SKILL = "head-above-prospecting";

async function files(dir: string, base = ""): Promise<{ name: string; data: Buffer }[]> {
  const out: { name: string; data: Buffer }[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "__pycache__") continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await files(path.join(dir, e.name), rel)));
    else out.push({ name: rel, data: await readFile(path.join(dir, e.name)) });
  }
  return out;
}

async function build(req: Request, key: string | null) {
  const base = appUrl() || new URL(req.url).origin;
  const list = (await files(path.join(process.cwd(), "claude-skill", SKILL))).filter((f) => f.name !== "config.json");
  const config = { appUrl: base, apiKey: key ?? "PASTE a key from CRM → Settings → Claude prospecting skill" };
  const zip = makeZip([...list, { name: "config.json", data: Buffer.from(JSON.stringify(config, null, 2) + "\n") }].map((f) => ({ name: `${SKILL}/${f.name}`, data: f.data })));
  return new NextResponse(new Uint8Array(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${SKILL}.zip"`, "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request) {
  if (!(await apiSession("STAFF"))) return NextResponse.json({ error: "Sign in to the CRM first" }, { status: 401 });
  return build(req, null);
}

export async function POST(req: Request) {
  const session = await apiSession("STAFF");
  if (!session) return NextResponse.json({ error: "Sign in to the CRM first" }, { status: 401 });
  const key = String((await req.formData().catch(() => null))?.get("key") ?? "");
  // Only a live key of the signed-in person goes into the download.
  const ok = key && (await db.apiToken.findFirst({ where: { hash: hashToken(key), userId: session.sub, revokedAt: null } }));
  if (!ok) return NextResponse.json({ error: "That key isn't yours or was revoked. Make a new one in Settings." }, { status: 400 });
  return build(req, key);
}
