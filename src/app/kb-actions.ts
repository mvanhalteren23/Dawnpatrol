"use server";
// Knowledge-base edits, shared by the CRM and the client portal. Clients edit their own
// receptionist's knowledge (live straight away); every change is recorded and can be undone.
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canAccessReceptionist, canManageReceptionist } from "@/lib/access";
import { KB_CATEGORIES } from "@/lib/constants";
import { markDirty, syncReceptionist } from "@/lib/elevenlabs";
import { recordActivity } from "@/lib/outreach";
import { recordKbChange, undoKbChange } from "@/lib/kb-history";
import type { SessionPayload } from "@/lib/session";
import { str } from "@/lib/utils";

async function guard(receptionistId: string) {
  const session = await getSession();
  if (!(await canAccessReceptionist(session, receptionistId))) throw new Error("Not allowed");
  return session!;
}

/** Team-only knowledge actions (approving Claude's drafts). */
async function manageGuard(receptionistId: string) {
  const session = await getSession();
  if (!(await canManageReceptionist(session, receptionistId))) throw new Error("Only the team can do that.");
  return session!;
}

/** The knowledge base itself: the team, and the client for their own receptionist. */
const editGuard = guard;

function done(returnTo: string, notice: string, kind: "notice" | "error" = "notice"): never {
  const safe = returnTo.startsWith("/crm/") || returnTo.startsWith("/portal") ? returnTo : "/";
  revalidatePath(safe.split("?")[0]!);
  redirect(`${safe}${safe.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(notice)}`);
}

/**
 * Client edits go live straight away (synced to ElevenLabs) and are logged on their account for
 * the team; team edits are marked for the next Sync, as before. Undo is always synced.
 */
async function afterChange(receptionistId: string, session: SessionPayload, what: string, syncNow = false) {
  const client = session.role === "CLIENT";
  if (!client && !syncNow) {
    await markDirty(receptionistId);
    return;
  }
  const r = await db.receptionist.findUnique({ where: { id: receptionistId }, select: { accountId: true, elevenLabsAgentId: true, name: true } });
  if (!r) return;
  if (client) {
    await recordActivity({ accountId: r.accountId, type: "NOTE", source: "portal", subject: `Knowledge base: ${what}`, body: `${session.email} changed ${r.name}'s knowledge base in the client portal. It's live; undo it under Knowledge base → History if needed.` }).catch((e) => console.warn("kb activity", e));
  }
  if (r.elevenLabsAgentId) {
    after(() => syncReceptionist(receptionistId).then(() => undefined).catch((e) => console.error("kb sync after edit", e)));
  } else {
    await markDirty(receptionistId);
  }
}

const actor = (session: SessionPayload) => ({ email: session.email, role: session.role });

export async function saveKbItem(receptionistId: string, returnTo: string, form: FormData) {
  const session = await editGuard(receptionistId);
  const client = session.role === "CLIENT";
  const id = str(form, "id");
  const category = (KB_CATEGORIES as readonly string[]).includes(str(form, "category")) ? str(form, "category") : "OTHER";
  const existing = id ? await db.knowledgeItem.findUnique({ where: { id } }) : null;
  if (id && (!existing || existing.receptionistId !== receptionistId)) throw new Error("Not found");
  const data = {
    category,
    title: str(form, "title"),
    content: str(form, "content"),
    // Clients don't see tags: keep whatever the team set.
    tags: client ? (existing?.tags ?? "") : str(form, "tags").replace(/\bclaude-draft\b,?/, "").trim(),
    isActive: form.get("isActive") === "on",
    updatedBy: session.email,
  };
  if (!data.title || !data.content) done(returnTo, "Title and content are required", "error");
  await db.$transaction(async (tx) => {
    if (existing) {
      await tx.knowledgeItem.update({ where: { id: existing.id }, data });
      await recordKbChange(tx, { receptionistId, itemId: existing.id, action: "update", before: existing, after: data, by: actor(session) });
    } else {
      const created = await tx.knowledgeItem.create({ data: { ...data, receptionistId } });
      await recordKbChange(tx, { receptionistId, itemId: created.id, action: "create", before: null, after: data, by: actor(session) });
    }
  });
  await afterChange(receptionistId, session, `${existing ? "edited" : "added"} "${data.title}"`);
  done(returnTo, client ? "Saved. Your receptionist will use it within a minute." : "Knowledge base updated");
}

export async function deleteKbItem(receptionistId: string, itemId: string, returnTo: string) {
  const session = await editGuard(receptionistId);
  const item = await db.knowledgeItem.findUnique({ where: { id: itemId } });
  if (!item || item.receptionistId !== receptionistId) done(returnTo, "That item was already deleted");
  await db.$transaction(async (tx) => {
    await tx.knowledgeItem.delete({ where: { id: itemId } });
    await recordKbChange(tx, { receptionistId, itemId, action: "delete", before: item, after: null, by: actor(session) });
  });
  await afterChange(receptionistId, session, `deleted "${item.title}"`);
  done(returnTo, "Item deleted. You can undo it under History.");
}

export async function activateAllDrafts(receptionistId: string, returnTo: string) {
  const session = await manageGuard(receptionistId);
  const drafts = await db.knowledgeItem.findMany({ where: { receptionistId, tags: { contains: "claude-draft" } } });
  await db.$transaction(async (tx) => {
    for (const d of drafts) {
      const next = { ...d, isActive: true, tags: "" };
      await tx.knowledgeItem.update({ where: { id: d.id }, data: { isActive: true, tags: "" } });
      await recordKbChange(tx, { receptionistId, itemId: d.id, action: "update", before: d, after: next, by: actor(session) });
    }
  });
  await markDirty(receptionistId);
  done(returnTo, "Drafts activated");
}

/** Roll back one change (the team or the client, on their own receptionist). */
export async function undoKbRevision(receptionistId: string, revisionId: string, returnTo: string) {
  const session = await editGuard(receptionistId);
  const res = await undoKbChange(receptionistId, revisionId, actor(session));
  if (res.ok) await afterChange(receptionistId, session, "undid a change", true);
  done(returnTo, res.message, res.ok ? "notice" : "error");
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
