"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { setManualDone } from "@/lib/launch-check";
import { PRICES } from "@/lib/site-content";

export async function toggleLaunchItem(key: string, done: boolean) {
  await requireAdmin();
  await setManualDone(key, done);
  revalidatePath("/crm/launch");
  redirect("/crm/launch#yours");
}

/** Stop offering old plans at checkout (nobody is subscribed to them). They can be switched back on in the database. */
export async function hideOldPlans() {
  await requireAdmin();
  const res = await db.plan.updateMany({ where: { kind: "plan", isActive: true, priceCents: { not: PRICES.CAD.monthly * 100 }, subscriptions: { none: {} } }, data: { isActive: false } });
  revalidatePath("/crm/launch");
  redirect(`/crm/launch?notice=${encodeURIComponent(res.count ? `Hid ${res.count} old plan${res.count === 1 ? "" : "s"}` : "Nothing to hide: any remaining old plan has a subscriber")}`);
}

/** Set Twilio's backup address on every number that answers through this site. */
export async function setBackupAnswering() {
  await requireAdmin();
  let msg: Record<string, string>;
  try {
    const n = await (await import("@/lib/agent-fallback")).applyFallbackUrls();
    msg = { notice: n ? `Backup answering set on ${n} number${n === 1 ? "" : "s"}` : "Every number already has it" };
  } catch (e) {
    msg = { error: (e as Error).message.slice(0, 200) };
  }
  revalidatePath("/crm/launch");
  redirect(`/crm/launch?${new URLSearchParams(msg).toString()}`);
}
