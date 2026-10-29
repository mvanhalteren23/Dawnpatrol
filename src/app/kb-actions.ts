"use server";
// Knowledge-base edits, shared by the CRM and the client portal.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canAccessReceptionist, canManageReceptionist } from "@/lib/access";
import { KB_CATEGORIES } from "@/lib/constants";
import { markDirty } from "@/lib/elevenlabs";
import { str } from "@/lib/utils";

async function guard(receptionistId: string) {
  const session = await getSession();
  if (!(await canAccessReceptionist(session, receptionistId))) throw new Error("Not allowed");
  return session!;
}

/** Changing what the agent knows is done by the team (managed service); clients request changes. */
async function manageGuard(receptionistId: string) {
  const session = await getSession();
  if (!(await canManageReceptionist(session, receptionistId))) throw new Error("Only the team can change the receptionist's knowledge. Use Request a change.");
  return session!;
}

function done(returnTo: string, notice: string): never {
  const safe = returnTo.startsWith("/crm/") || returnTo.startsWith("/portal") ? returnTo : "/";
  revalidatePath(safe.split("?")[0]!);
  redirect(`${safe}${safe.includes("?") ? "&" : "?"}notice=${encodeURIComponent(notice)}`);
}

export async function saveKbItem(receptionistId: string, returnTo: string, form: FormData) {
  const session = await manageGuard(receptionistId);
  const id = str(form, "id");
  const category = (KB_CATEGORIES as readonly string[]).includes(str(form, "category")) ? str(form, "category") : "OTHER";
  const data = {
    category,
    title: str(form, "title"),
    content: str(form, "content"),
    tags: str(form, "tags").replace(/\bclaude-draft\b,?/, "").trim(),
    isActive: form.get("isActive") === "on",
    updatedBy: session.email,
  };
  if (!data.title || !data.content) done(returnTo, "Title and content are required");
  if (id) {
    const existing = await db.knowledgeItem.findUnique({ where: { id } });
    if (!existing || existing.receptionistId !== receptionistId) throw new Error("Not found");
    await db.knowledgeItem.update({ where: { id }, data });
  } else {
    await db.knowledgeItem.create({ data: { ...data, receptionistId } });
  }
  await markDirty(receptionistId);
  done(returnTo, "Knowledge base updated");
}

export async function deleteKbItem(receptionistId: string, itemId: string, returnTo: string) {
  await manageGuard(receptionistId);
  await db.knowledgeItem.deleteMany({ where: { id: itemId, receptionistId } });
  await markDirty(receptionistId);
  done(returnTo, "Item deleted");
}

export async function activateAllDrafts(receptionistId: string, returnTo: string) {
  await manageGuard(receptionistId);
  await db.knowledgeItem.updateMany({ where: { receptionistId, tags: { contains: "claude-draft" } }, data: { isActive: true, tags: "" } });
  await markDirty(receptionistId);
  done(returnTo, "Drafts activated");
}

export async function markCallFollowedUp(receptionistId: string, callId: string, returnTo: string) {
  await guard(receptionistId);
  await db.callLog.updateMany({ where: { id: callId, receptionistId }, data: { followedUpAt: new Date() } });
  done(returnTo, "Marked as followed up");
}

export async function refreshCalls(receptionistId: string, returnTo: string) {
  await guard(receptionistId);
  const { syncCalls } = await import("@/lib/call-sync");
  const r = await syncCalls({ receptionistId });
  if (r.errors.length) console.error("refresh calls", receptionistId, r.errors);
  // Clients see a plain message; the provider's raw error goes to the logs.
  done(returnTo, r.errors.length ? "Couldn't fetch new calls right now. Please try again in a few minutes." : r.added ? `${r.added} new call${r.added === 1 ? "" : "s"} added` : "Calls are up to date");
}
