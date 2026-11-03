"use server";
import { redirect } from "next/navigation";
import { completeMfaLogin, login } from "@/lib/auth";
import type { SessionPayload } from "@/lib/session";
import { str } from "@/lib/utils";

function landing(session: SessionPayload, next: string): never {
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "";
  if (session.role === "ADMIN" || session.role === "REP") redirect(safeNext.startsWith("/crm") || safeNext.startsWith("/portal") ? safeNext : "/crm");
  redirect(safeNext.startsWith("/portal") ? safeNext : "/portal");
}

export async function loginAction(_prev: { error?: string } | undefined, form: FormData) {
  const next = str(form, "next");
  const result = await login(str(form, "email"), str(form, "password"), next);
  if (!result) return { error: "Invalid email or password" };
  if ("mfa" in result) redirect("/login/verify");
  landing(result.session, next);
}

export async function verifyCodeAction(_prev: { error?: string } | undefined, form: FormData) {
  const result = await completeMfaLogin(str(form, "code"));
  if ("error" in result) return { error: result.error };
  landing(result.session, result.next);
}
