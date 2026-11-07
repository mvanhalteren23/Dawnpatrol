"use server";
import { redirect } from "next/navigation";
import { readUnsubscribeToken } from "@/lib/unsubscribe-token";
import { suppress } from "@/lib/suppression";

export async function unsubscribe(token: string) {
  const email = readUnsubscribeToken(token);
  if (email) await suppress(email, "link");
  redirect(`/unsubscribe/${token}?done=1`);
}
