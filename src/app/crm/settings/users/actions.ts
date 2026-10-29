"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { optStr, str } from "@/lib/utils";

// Team management (administrators only): add reps/admins, change roles, reset passwords, turn off access.

const PAGE = "/crm/settings/users";

function back(params: Record<string, string>): never {
  revalidatePath(PAGE);
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`);
}

function staffRole(v: string): "ADMIN" | "REP" | null {
  return v === "ADMIN" || v === "REP" ? v : null;
}

/** Never leave the CRM without an active administrator. */
async function otherActiveAdmins(userId: string) {
  return db.user.count({ where: { role: "ADMIN", disabled: false, id: { not: userId } } });
}

export async function createUser(form: FormData) {
  await requireAdmin();
  const email = str(form, "email").trim().toLowerCase();
  const password = str(form, "password");
  const role = staffRole(str(form, "role"));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back({ error: "Enter a valid email" });
  if (!role) back({ error: "Pick a role" });
  if (password.length < 10) back({ error: "The temporary password must be at least 10 characters" });
  if (await db.user.findUnique({ where: { email } })) back({ error: `${email} already has a login` });
  await db.user.create({ data: { email, name: optStr(form, "name"), role, passwordHash: await hashPassword(password) } });
  back({ notice: `Added ${email}. Send them the sign-in link and temporary password; they can change it under Settings.` });
}

export async function updateUser(userId: string, form: FormData) {
  const session = await requireAdmin();
  const role = staffRole(str(form, "role"));
  if (!role) back({ error: "Pick a role" });
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.role === "ADMIN" && role !== "ADMIN" && !(await otherActiveAdmins(userId))) back({ error: "Keep at least one administrator" });
  // Sign-in email (e.g. moving from a personal Gmail to the business address).
  const email = str(form, "email").toLowerCase();
  if (email && email !== user.email) {
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) back({ error: "Enter a valid email" });
    if (await db.user.findUnique({ where: { email } })) back({ error: `${email} is already a user` });
  }
  await db.user.update({ where: { id: userId }, data: { role, name: optStr(form, "name"), ...(email && email !== user.email ? { email } : {}) } });
  if (email && email !== user.email && userId === session.sub) back({ notice: `Saved. Sign in with ${email} from now on.` });
  back({ notice: userId === session.sub && role !== "ADMIN" ? "Saved. You're now a sales rep." : "Saved" });
}

export async function resetUserPassword(userId: string, form: FormData) {
  await requireAdmin();
  const password = str(form, "password");
  if (password.length < 10) back({ error: "The new password must be at least 10 characters" });
  const user = await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password), sessionsValidAfter: new Date(), failedLogins: 0, lockedUntil: null } });
  back({ notice: `Password reset for ${user.email}. They've been signed out everywhere.` });
}

/**
 * Turn a login off (or back on). Their history stays; their accounts go to the person picked
 * (or become unassigned) so nothing is left with someone who can't work it.
 */
export async function setUserAccess(userId: string, form: FormData) {
  const session = await requireAdmin();
  const disable = str(form, "action") === "disable";
  if (disable) {
    if (userId === session.sub) back({ error: "You can't turn off your own login" });
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role === "ADMIN" && !(await otherActiveAdmins(userId))) back({ error: "Keep at least one administrator" });
    const to = optStr(form, "reassignTo");
    const target = to ? await db.user.findFirst({ where: { id: to, role: { in: ["ADMIN", "REP"] }, disabled: false, NOT: { id: userId } } }) : null;
    const moved = await db.account.updateMany({ where: { ownerId: userId }, data: { ownerId: target?.id ?? null } });
    await db.user.update({ where: { id: userId }, data: { disabled: true } });
    back({ notice: `${user.email} can no longer sign in. ${moved.count} accounts ${target ? `moved to ${target.name || target.email}` : "are now unassigned"}.` });
  }
  const user = await db.user.update({ where: { id: userId }, data: { disabled: false } });
  back({ notice: `${user.email} can sign in again` });
}
