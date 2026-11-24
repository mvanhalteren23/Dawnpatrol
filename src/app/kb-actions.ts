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
import { looksLikeInstructions } from "@/lib/safety-rules";
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
    title: str(form, "title").trim().slice(0, 200),
    content: str(form, "content").trim().slice(0, 8000),
    // Clients don't see tags: keep whatever the team set.
    tags: client ? (existing?.tags ?? "") : str(form, "tags").replace(/\bclaude-draft\b,?/, "").trim(),
    isActive: form.get("isActive") === "on",
    updatedBy: session.email,
  };
  if (!data.title || !data.content) done(returnTo, "Title and content are required", "error");
  // Knowledge is facts about the business, never instructions to the AI (prompt injection).
  if (looksLikeInstructions(`${data.title}\n${data.content}`)) done(returnTo, "That reads like an instruction to the AI rather than information about the business, so it wasn't saved. Describe the fact instead (for example \"We're closed on Sundays\"), or ask the team.", "error");
  // A client can't grow the knowledge base without limit (it's sent to the agent on every sync).
  if (!existing && (await db.knowledgeItem.count({ where: { receptionistId } })) >= 300) done(returnTo, "This knowledge base has reached 300 entries. Combine or remove some, or ask the team.", "error");
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

/**
 * The drafts review panel: approve the ticked drafts (with any edits made on the same screen), or
 * discard them. Every change is recorded in the history, so it can be undone.
 */
export async function reviewDrafts(receptionistId: string, returnTo: string, form: FormData) {
  const session = await manageGuard(receptionistId);
  const { approvedTags, approvedTitle, isDraft } = await import("@/lib/draft-review-rules");
  const discard = form.get("intent") === "discard";
  const ids = form.getAll("pick").map(String);
  if (!ids.length) done(returnTo, "Tick the drafts to approve or discard first", "error");
  const drafts = (await db.knowledgeItem.findMany({ where: { receptionistId, id: { in: ids } } })).filter(isDraft);
  let changed = 0;
  let skipped = 0;
  await db.$transaction(async (tx) => {
    for (const d of drafts) {
      if (discard) {
        await tx.knowledgeItem.delete({ where: { id: d.id } });
        await recordKbChange(tx, { receptionistId, itemId: d.id, action: "delete", before: d, after: null, by: actor(session) });
        changed++;
        continue;
      }
      const category = (KB_CATEGORIES as readonly string[]).includes(str(form, `category_${d.id}`)) ? str(form, `category_${d.id}`) : d.category;
      const title = approvedTitle(str(form, `title_${d.id}`).trim() || d.title);
      const content = (str(form, `content_${d.id}`).trim() || d.content).slice(0, 8000);
      // Edited text is checked like any other entry: facts, never instructions to the AI.
      if (looksLikeInstructions(`${title}\n${content}`)) {
        skipped++;
        continue;
      }
      const data = { category, title, content, tags: approvedTags(d.tags), isActive: true, updatedBy: session.email };
      await tx.knowledgeItem.update({ where: { id: d.id }, data });
      await recordKbChange(tx, { receptionistId, itemId: d.id, action: "update", before: d, after: { ...d, ...data }, by: actor(session) });
      changed++;
    }
  });
  // Approvals go live straight away (the agent syncs in the background).
  if (changed) await afterChange(receptionistId, session, discard ? `discarded ${changed} drafts` : `approved ${changed} drafts`, true);
  const what = discard ? `${changed} draft${changed === 1 ? "" : "s"} discarded` : `${changed} draft${changed === 1 ? "" : "s"} approved: live within a minute`;
  done(returnTo, skipped ? `${what}. ${skipped} not approved: the edited text read like an instruction to the AI.` : `${what}.`, skipped ? "error" : "notice");
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
