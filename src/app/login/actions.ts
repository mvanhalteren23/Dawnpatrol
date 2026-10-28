"use server";
import { redirect } from "next/navigation";
import { login } from "@/lib/auth";
import { str } from "@/lib/utils";

export async function loginAction(_prev: { error?: string } | undefined, form: FormData) {
  const session = await login(str(form, "email"), str(form, "password"));
  if (!session) return { error: "Invalid email or password" };
  const next = str(form, "next");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "";
  if (session.role === "ADMIN" || session.role === "REP") redirect(safeNext.startsWith("/crm") || safeNext.startsWith("/portal") ? safeNext : "/crm");
  redirect(safeNext.startsWith("/portal") ? safeNext : "/portal");
}
