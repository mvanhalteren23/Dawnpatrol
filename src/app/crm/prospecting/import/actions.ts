"use server";
import { redirect } from "next/navigation";
import { unstable_rethrow } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { importPack } from "@/lib/prospect-pack";
import { extractJson, parsePack } from "@/lib/prospect-pack-rules";
import { str } from "@/lib/utils";

const fail = (error: string): never => redirect(`/crm/prospecting/import?error=${encodeURIComponent(error)}`);

/** Prospecting → Import from Claude: the pack pasted or uploaded from the Claude skill. */
export async function importPackFromForm(form: FormData) {
  const session = await requireStaff();
  const file = form.get("file");
  let raw = str(form, "pack");
  if (file && typeof file === "object" && "text" in file && file.size > 0) {
    if (file.size > 2_000_000) fail("That file is too big: import at most 50 prospects at a time.");
    raw = await file.text();
  }
  if (!raw.trim()) fail("Paste the prospect pack, or choose the .json file Claude gave you.");
  let runId = "";
  try {
    const pack = parsePack(extractJson(raw));
    if (!pack.prospects.length) fail(pack.problems.join(" ") || "No prospects in that pack.");
    ({ runId } = await importPack(pack, session, str(form, "tags").split(",")));
  } catch (err) {
    unstable_rethrow(err);
    fail((err as Error).message);
  }
  redirect(`/crm/prospecting/${runId}`);
}
