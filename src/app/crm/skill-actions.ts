"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { createApiToken } from "@/lib/api-tokens";
import { str } from "@/lib/utils";

// Keys for the Claude prospecting skill. A new key is returned once (to the page) and never stored.

export type NewKeyState = { key?: string; error?: string };

export async function createSkillKey(_prev: NewKeyState | undefined, form: FormData): Promise<NewKeyState> {
  const session = await requireStaff();
  try {
    const key = await createApiToken(session.sub, str(form, "name") || "Claude prospecting skill");
    revalidatePath("/crm/settings");
    return { key };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function revokeSkillKey(id: string) {
  const session = await requireStaff();
  await db.apiToken.updateMany({ where: { id, userId: session.sub, revokedAt: null }, data: { revokedAt: new Date() } });
  revalidatePath("/crm/settings");
}
