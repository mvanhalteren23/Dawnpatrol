import "server-only";
import { db } from "./db";
import { snapshot, undoPlan, type KbSnapshot } from "./kb-history-rules";

// Knowledge-base history: every edit by the team or the client is recorded with the item before
// and after, and any change can be undone (the undo is recorded too, so it can be undone as well).

export type KbActor = { email: string | null; role: string };

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

export async function recordKbChange(
  tx: Tx | typeof db,
  o: { receptionistId: string; itemId: string; action: "create" | "update" | "delete"; before: KbSnapshot | null; after: KbSnapshot | null; by: KbActor; undoOfId?: string },
) {
  return tx.knowledgeRevision.create({
    data: {
      receptionistId: o.receptionistId,
      itemId: o.itemId,
      action: o.action,
      before: o.before ? JSON.stringify(snapshot(o.before)) : null,
      after: o.after ? JSON.stringify(snapshot(o.after)) : null,
      byEmail: o.by.email,
      byRole: o.by.role,
      undoOfId: o.undoOfId ?? null,
    },
  });
}

/** Undo one change on this receptionist's knowledge base. */
export async function undoKbChange(receptionistId: string, revisionId: string, by: KbActor): Promise<{ ok: boolean; message: string }> {
  const rev = await db.knowledgeRevision.findUnique({ where: { id: revisionId } });
  if (!rev || rev.receptionistId !== receptionistId) return { ok: false, message: "That change wasn't found." };
  const item = await db.knowledgeItem.findUnique({ where: { id: rev.itemId } });
  const plan = undoPlan(rev, Boolean(item && item.receptionistId === receptionistId));
  if (plan.op === "none") return { ok: false, message: plan.reason };

  await db.$transaction(async (tx) => {
    if (plan.op === "delete") {
      await tx.knowledgeItem.delete({ where: { id: rev.itemId } });
      await recordKbChange(tx, { receptionistId, itemId: rev.itemId, action: "delete", before: item!, after: null, by, undoOfId: rev.id });
    } else if (item) {
      await tx.knowledgeItem.update({ where: { id: item.id }, data: { ...plan.data, updatedBy: by.email } });
      await recordKbChange(tx, { receptionistId, itemId: item.id, action: "update", before: item, after: plan.data, by, undoOfId: rev.id });
    } else {
      // The item was deleted: bring it back under the same id, so its history stays together.
      await tx.knowledgeItem.create({ data: { id: rev.itemId, receptionistId, ...plan.data, updatedBy: by.email } });
      await recordKbChange(tx, { receptionistId, itemId: rev.itemId, action: "create", before: null, after: plan.data, by, undoOfId: rev.id });
    }
    await tx.knowledgeRevision.update({ where: { id: rev.id }, data: { undoneAt: new Date() } });
  });
  return { ok: true, message: plan.op === "delete" ? "Change undone: the item was removed" : item ? "Change undone: the earlier version is back" : "Change undone: the item is back" };
}

export async function kbHistory(receptionistId: string, take = 30) {
  return db.knowledgeRevision.findMany({ where: { receptionistId }, orderBy: { createdAt: "desc" }, take });
}
