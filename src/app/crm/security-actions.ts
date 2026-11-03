"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { issueSession, requireAdmin, requireStaff } from "@/lib/auth";
import { open, seal } from "@/lib/secret-box";
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, verifyTotp } from "@/lib/totp";
import { safeJson, str } from "@/lib/utils";

// Two-step sign-in for the team: set up, confirm, turn off; an admin can reset someone's (lost phone).

export async function startTwoStepSetup() {
  const session = await requireStaff();
  const user = await db.user.findUniqueOrThrow({ where: { id: session.sub } });
  if (!user.totpEnabledAt) await db.user.update({ where: { id: user.id }, data: { totpSecret: seal(newTotpSecret()) } });
  revalidatePath("/crm/settings");
  redirect("/crm/settings#two-step");
}

export type ConfirmState = { error?: string; codes?: string[] };

export async function confirmTwoStep(_prev: ConfirmState | undefined, form: FormData): Promise<ConfirmState> {
  const session = await requireStaff();
  const user = await db.user.findUniqueOrThrow({ where: { id: session.sub } });
  if (user.totpEnabledAt) return { error: "Two-step sign-in is already on." };
  if (!user.totpSecret) return { error: "Start the setup first." };
  const step = verifyTotp(open(user.totpSecret), str(form, "code"));
  if (step == null) return { error: "That code didn't match. Make sure your phone's clock is set automatically, and enter the newest code." };
  const codes = newRecoveryCodes();
  // Sign out every other session: from now on each sign-in needs the second step.
  const now = new Date();
  await db.user.update({ where: { id: user.id }, data: { totpEnabledAt: now, totpLastStep: step, recoveryCodes: JSON.stringify(codes.map(hashRecoveryCode)), sessionsValidAfter: now } });
  await issueSession(user);
  revalidatePath("/crm/settings");
  return { codes };
}

export async function cancelTwoStepSetup() {
  const session = await requireStaff();
  await db.user.updateMany({ where: { id: session.sub, totpEnabledAt: null }, data: { totpSecret: null } });
  revalidatePath("/crm/settings");
  redirect("/crm/settings#two-step");
}

export async function disableTwoStep(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const session = await requireStaff();
  const user = await db.user.findUniqueOrThrow({ where: { id: session.sub } });
  if (!user.totpEnabledAt || !user.totpSecret) return { error: "Two-step sign-in is already off." };
  const code = str(form, "code");
  const ok = verifyTotp(open(user.totpSecret), code) != null || safeJson<string[]>(user.recoveryCodes, []).includes(hashRecoveryCode(code));
  if (!ok) return { error: "Enter a current code (or a recovery code) to turn it off." };
  await db.user.update({ where: { id: user.id }, data: { totpEnabledAt: null, totpSecret: null, totpLastStep: null, recoveryCodes: "" } });
  revalidatePath("/crm/settings");
  redirect("/crm/settings?notice=Two-step sign-in is off");
}

/** Admin: someone lost their phone and their recovery codes. They set it up again after signing in. */
export async function resetUserTwoStep(userId: string) {
  const session = await requireAdmin();
  if (userId === session.sub) redirect("/crm/settings/users?error=Turn your own off under Settings");
  await db.user.update({ where: { id: userId }, data: { totpEnabledAt: null, totpSecret: null, totpLastStep: null, recoveryCodes: "", sessionsValidAfter: new Date() } });
  revalidatePath("/crm/settings/users");
  redirect("/crm/settings/users?notice=Two-step sign-in reset. They can sign in with their password and set it up again.");
}
