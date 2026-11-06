"use server";
// The client's knowledge-base review page (no login: the link's token is the access check).
// Every change saves straight away, is recorded in the knowledge history (undo in the CRM), and
// marks the agent for sync; pressing "I'm done" syncs it and tells the team.
import { after } from "next/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { KB_CATEGORIES } from "@/lib/constants";
import { recordKbChange } from "@/lib/kb-history";
import { looksLikeInstructions } from "@/lib/safety-rules";
import { markDirty, syncReceptionist } from "@/lib/elevenlabs";
import { recordActivity } from "@/lib/outreach";
import { openReviewLink } from "@/lib/kb-review";
import { confirmedFields, MAX_CHANGES_PER_HOUR } from "@/lib/kb-review-rules";
import { str } from "@/lib/utils";

function back(token: string, params: Record<string, string>, anchor = ""): never {
  redirect(`/review/${token}?${new URLSearchParams(params).toString()}${anchor ? `#${anchor}` : ""}`);
}

async function linkOrFail(token: string) {
  const link = await openReviewLink(token);
  if (!link) redirect(`/review/${token}`); // the page explains an expired or revoked link
  return link!;
}

const INSTRUCTION_ERROR = "That reads like an instruction to the AI rather than information about your business, so it wasn't saved. Describe the fact instead, for example \"We're closed on Sundays\".";

async function tooManyChanges(receptionistId: string, actor: string): Promise<boolean> {
  return (await db.knowledgeRevision.count({ where: { receptionistId, byEmail: actor, createdAt: { gte: new Date(Date.now() - 3600_000) } } })) >= MAX_CHANGES_PER_HOUR;
}

async function changed(linkId: string, receptionistId: string) {
  await db.kbReviewLink.update({ where: { id: linkId }, data: { changes: { increment: 1 } } });
  await markDirty(receptionistId);
}

/** Save, keep ("use") or remove one entry. */
export async function reviewItem(token: string, itemId: string, form: FormData) {
  const link = await linkOrFail(token);
  const r = link.receptionist;
  const actor = `review link${link.sentTo ? ` (${link.sentTo})` : ""}`;
  const by = { email: actor, role: "client" };
  const item = await db.knowledgeItem.findUnique({ where: { id: itemId } });
  if (!item || item.receptionistId !== r.id) back(token, { error: "That entry was already removed" });
  if (await tooManyChanges(r.id, actor)) back(token, { error: "That's a lot of changes in an hour. Please take a break and try again shortly." });
  const intent = str(form, "intent");
  if (intent === "remove") {
    await db.$transaction(async (tx) => {
      await tx.knowledgeItem.delete({ where: { id: item!.id } });
      await recordKbChange(tx, { receptionistId: r.id, itemId: item!.id, action: "delete", before: item!, after: null, by });
    });
    await changed(link.id, r.id);
    back(token, { notice: `Removed "${item!.title.replace(/\s*\(assumed\)$/i, "")}"` });
  }
  const title = str(form, "title").trim() || item!.title;
  const content = str(form, "content").trim();
  if (!content) back(token, { error: "Add the answer before saving (or remove the entry)" }, item!.id);
  if (looksLikeInstructions(`${title}\n${content}`)) back(token, { error: INSTRUCTION_ERROR }, item!.id);
  const data = { ...confirmedFields(item!, { title, content }), updatedBy: actor };
  await db.$transaction(async (tx) => {
    await tx.knowledgeItem.update({ where: { id: item!.id }, data });
    await recordKbChange(tx, { receptionistId: r.id, itemId: item!.id, action: "update", before: item!, after: { ...data, category: item!.category }, by });
  });
  await changed(link.id, r.id);
  back(token, { notice: `Saved "${data.title}"` }, item!.id);
}

/** Add something the receptionist should know. */
export async function reviewAdd(token: string, form: FormData) {
  const link = await linkOrFail(token);
  const r = link.receptionist;
  const actor = `review link${link.sentTo ? ` (${link.sentTo})` : ""}`;
  const category = (KB_CATEGORIES as readonly string[]).includes(str(form, "category")) ? str(form, "category") : "OTHER";
  const title = str(form, "title").trim().slice(0, 200);
  const content = str(form, "content").trim().slice(0, 4000);
  if (!title || !content) back(token, { error: "Add a short title and the answer" }, "add");
  if (looksLikeInstructions(`${title}\n${content}`)) back(token, { error: INSTRUCTION_ERROR }, "add");
  if (await tooManyChanges(r.id, actor)) back(token, { error: "That's a lot of changes in an hour. Please take a break and try again shortly." });
  if ((await db.knowledgeItem.count({ where: { receptionistId: r.id } })) >= 300) back(token, { error: "There are already 300 entries. Combine or remove some first." }, "add");
  const data = { receptionistId: r.id, category, title, content, tags: "client-reviewed", isActive: true, updatedBy: actor };
  await db.$transaction(async (tx) => {
    const created = await tx.knowledgeItem.create({ data });
    await recordKbChange(tx, { receptionistId: r.id, itemId: created.id, action: "create", before: null, after: data, by: { email: actor, role: "client" } });
  });
  await changed(link.id, r.id);
  back(token, { notice: `Added "${title}"` }, "add");
}

/** The client is finished: sync the agent and tell the team. */
export async function reviewFinish(token: string, form: FormData) {
  const link = await linkOrFail(token);
  const r = link.receptionist;
  const note = str(form, "note").trim().slice(0, 2000);
  await db.kbReviewLink.update({ where: { id: link.id }, data: { finishedAt: new Date(), finishNote: note } });
  await recordActivity({
    accountId: r.accountId,
    type: "NOTE",
    source: "portal",
    subject: `Knowledge base reviewed by the client (${r.name})`,
    body: `${link.sentTo ?? "The client"} finished reviewing ${r.name}'s knowledge base: ${link.changes} change${link.changes === 1 ? "" : "s"}.${note ? `\nTheir note: "${note}"` : ""}\nEvery change is in the agent's knowledge history and can be undone.`,
  }).catch((e) => console.warn("review activity", e));
  after(async () => {
    if (r.elevenLabsAgentId) await syncReceptionist(r.id).catch((e) => console.error("review sync", e));
    const { supportAddress } = await import("@/lib/google");
    const to = await supportAddress().catch(() => null);
    if (to) {
      const { sendPlainEmail } = await import("@/lib/outreach");
      const { appUrl } = await import("@/lib/app-url");
      await sendPlainEmail({ to, subject: `${r.businessName} reviewed their knowledge base`, body: `${link.changes} change${link.changes === 1 ? "" : "s"} to ${r.name}.${note ? `\n\nTheir note: "${note}"` : ""}\n\n${appUrl()}/crm/receptionists/${r.id}` }).catch((e) => console.warn("review email", e));
    }
  });
  back(token, { finished: "1" });
}
