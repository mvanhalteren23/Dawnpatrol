"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { issueSession, requireAdmin, requireStaff } from "@/lib/auth";
import { open, seal } from "@/lib/secret-box";
import { diagnoseTotp, hashRecoveryCode, newRecoveryCodes, newTotpSecret, verifyTotp } from "@/lib/totp";
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
  const secret = open(user.totpSecret);
  // A little extra leeway while setting up (2 steps either side: phones whose clock is slightly off).
  const step = verifyTotp(secret, str(form, "code"), { window: 2 });
  if (step == null) {
    const why = diagnoseTotp(secret, str(form, "code"));
    if (why?.kind === "clock") return { error: `That code is right, but your phone's clock is off by about ${Math.abs(why.minutes)} minute${Math.abs(why.minutes) === 1 ? "" : "s"}. On the phone: Settings → System → Date & time → turn on "Set time automatically", then enter the newest code.` };
    return { error: "That code didn't match this setup. In Google Authenticator, delete any older \"Head Above Digital\" entry, add this one again (button above, or type the key), and enter its newest 6-digit code. Still stuck? Press \"Start over with a new key\"." };
  }
  const codes = newRecoveryCodes();
  // Sign out every other session: from now on each sign-in needs the second step.
  const now = new Date();
  await db.user.update({ where: { id: user.id }, data: { totpEnabledAt: now, totpLastStep: step, recoveryCodes: JSON.stringify(codes.map(hashRecoveryCode)), sessionsValidAfter: now } });
  await issueSession(user);
  revalidatePath("/crm/settings");
  return { codes };
}

/** A fresh key (e.g. the old one was added to the wrong app, or setup was started twice). */
export async function restartTwoStepSetup() {
  const session = await requireStaff();
  await db.user.updateMany({ where: { id: session.sub, totpEnabledAt: null }, data: { totpSecret: seal(newTotpSecret()) } });
  revalidatePath("/crm/settings");
  redirect("/crm/settings#two-step");
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
