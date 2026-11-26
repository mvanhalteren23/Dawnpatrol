"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { canTouch } from "@/lib/team";
import { ingestLeads, promoteLeads } from "@/lib/prospect-leads";
import { parseIntake } from "@/lib/prospect-leads-rules";

function back(qs: Record<string, string>, keep: string): never {
  revalidatePath("/crm/leads");
  const params = new URLSearchParams(keep);
  for (const [k, v] of Object.entries(qs)) params.set(k, v);
  params.delete(qs.notice ? "error" : "notice");
  redirect(`/crm/leads?${params.toString()}`);
}

function picked(form: FormData): string[] {
  return form.getAll("pick").map(String).filter(Boolean).slice(0, 200);
}

async function promote(form: FormData, mode: "prospects" | "dialer") {
  const session = await requireStaff();
  const keep = String(form.get("keep") ?? "");
  const ids = picked(form);
  if (!ids.length) back({ error: "Tick at least one lead first." }, keep);
  const r = await promoteLeads(ids, mode, session, (ownerId) => canTouch(session, ownerId));
  const where = mode === "dialer" ? "the dialer's Call list" : "prospects";
  const parts = [`${r.created} added to ${where}`];
  if (r.linked) parts.push(`${r.linked} matched existing accounts and were updated`);
  if (r.skipped) parts.push(`${r.skipped} skipped (owned by another rep or no match)`);
  back({ notice: parts.join(", ") + "." }, keep);
}

export async function addLeadsToProspects(form: FormData) {
  await promote(form, "prospects");
}

export async function addLeadsToDialer(form: FormData) {
  await promote(form, "dialer");
}

export async function dismissLeads(form: FormData) {
  await requireStaff();
  const keep = String(form.get("keep") ?? "");
  const ids = picked(form);
  if (!ids.length) back({ error: "Tick at least one lead first." }, keep);
  const { count } = await db.prospectLead.updateMany({ where: { id: { in: ids }, status: "NEW" }, data: { status: "DISMISSED" } });
  back({ notice: `${count} dismissed. Filter by "Dismissed" to restore one.` }, keep);
}

export async function restoreLead(id: string) {
  await requireStaff();
  await db.prospectLead.updateMany({ where: { id, status: "DISMISSED" }, data: { status: "NEW" } });
  revalidatePath("/crm/leads");
}

/** Paste box: the same JSON the skill posts, for runs done elsewhere or by hand. */
export async function pasteLeads(form: FormData) {
  const session = await requireStaff();
  const raw = String(form.get("json") ?? "").trim();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    back({ error: "That isn't valid JSON. Paste the leads block exactly as the research skill printed it." }, "");
  }
  const intake = parseIntake(body);
  if (typeof intake === "string") back({ error: intake }, "");
  const s = await ingestLeads(intake, { source: "paste", createdById: session.sub });
  const msg = `${s.created} new, ${s.updated} updated${s.alreadyInCrm ? `, ${s.alreadyInCrm} already in the CRM` : ""}${s.errors.length ? `. ${s.errors.length} rejected: ${s.errors.slice(0, 3).map((e) => e.message).join("; ")}` : ""}.`;
  back({ notice: msg }, "");
}
