"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { dialableNumber } from "@/lib/twilio";
import { str } from "@/lib/utils";
import { PUSH_CATEGORIES, type PushCategory, isCategory } from "@/lib/push-rules";

// Settings → Phone & app: your mobile, phone notifications and passkeys (each user their own).

const PAGE = "/crm/settings";

function back(params: Record<string, string>): never {
  revalidatePath(PAGE);
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}#phone-app`);
}

export async function saveMyMobile(form: FormData) {
  const session = await requireStaff();
  const raw = str(form, "phone").trim();
  const phone = raw ? dialableNumber(raw) : null;
  if (raw && !phone) back({ error: "Enter your mobile as a 10-digit Canadian or US number" });
  await db.user.update({ where: { id: session.sub }, data: { phone } });
  back({ notice: phone ? "Mobile saved" : "Mobile removed" });
}

export async function savePushPrefs(form: FormData) {
  const session = await requireStaff();
  const on = new Set(form.getAll("on").map(String).filter(isCategory));
  const off = (Object.keys(PUSH_CATEGORIES) as PushCategory[]).filter((c) => !on.has(c));
  const quiet = form.get("quiet") === "on";
  const hour = (k: string, d: number) => {
    const n = Number(str(form, k));
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : d;
  };
  let timezone = str(form, "timezone").trim() || "America/Vancouver";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  } catch {
    timezone = "America/Vancouver";
  }
  const prefs = {
    off,
    quietStart: quiet ? hour("quietStart", 21) : null,
    quietEnd: quiet ? hour("quietEnd", 7) : null,
    urgentInQuiet: form.get("urgentInQuiet") === "on",
    timezone,
  };
  await db.user.update({ where: { id: session.sub }, data: { pushPrefs: JSON.stringify(prefs) } });
  back({ notice: "Notification settings saved" });
}

export async function removePushDevice(id: string) {
  const session = await requireStaff();
  await db.pushSubscription.deleteMany({ where: { id, userId: session.sub } });
  back({ notice: "Device removed: it won't get notifications any more" });
}

export async function removePasskey(id: string) {
  const session = await requireStaff();
  await db.passkey.deleteMany({ where: { id, userId: session.sub } });
  back({ notice: "Passkey removed. Also delete it from the phone's password manager (Google Password Manager → Head Above)." });
}
