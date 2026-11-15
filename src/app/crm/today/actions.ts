"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { OwnershipError, touchAccount } from "@/lib/team";
import { tomorrowMorning } from "@/lib/today-rules";

// One-tap actions on the Today screen. Each checks the rep may work the account (owner or unassigned).

function back(params?: Record<string, string>): never {
  revalidatePath("/crm/today");
  redirect(`/crm/today${params ? `?${new URLSearchParams(params).toString()}` : ""}`);
}

async function mayWork(accountId: string) {
  const session = await requireStaff();
  try {
    await touchAccount(session, accountId);
  } catch (err) {
    if (err instanceof OwnershipError) back({ error: err.message });
    throw err;
  }
  return session;
}

export async function todayDone(activityId: string) {
  const task = await db.activity.findUnique({ where: { id: activityId }, select: { accountId: true, type: true } });
  if (!task || task.type !== "TASK") back({ error: "That follow-up is gone" });
  await mayWork(task.accountId);
  await db.activity.update({ where: { id: activityId }, data: { completedAt: new Date() } });
  back({ notice: "Done" });
}

export async function todaySnooze(activityId: string, timezone: string) {
  const task = await db.activity.findUnique({ where: { id: activityId }, select: { accountId: true, type: true } });
  if (!task || task.type !== "TASK") back({ error: "That follow-up is gone" });
  await mayWork(task.accountId);
  await db.activity.update({ where: { id: activityId }, data: { dueAt: tomorrowMorning(new Date(), timezone) } });
  back({ notice: "Moved to tomorrow morning" });
}

export async function todayReviewed(accountId: string) {
  await mayWork(accountId);
  await db.account.update({ where: { id: accountId }, data: { needsReview: false } });
  revalidatePath("/crm", "layout");
  back({ notice: "Marked as checked" });
}

export async function todayReplyHandled(recipientId: string) {
  const r = await db.campaignRecipient.findUnique({ where: { id: recipientId }, select: { accountId: true } });
  if (!r) back();
  await mayWork(r.accountId);
  await db.campaignRecipient.update({ where: { id: recipientId }, data: { status: "DONE", note: "Reply handled (Today screen)" } });
  back({ notice: "Reply cleared" });
}
