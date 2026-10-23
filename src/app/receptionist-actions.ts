"use server";
// Receptionist availability and follow-up settings, shared by the CRM and the client portal.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canAccessReceptionist } from "@/lib/access";
import { availabilityFromForm, followUpFromForm } from "@/lib/booking";
import { markDirty } from "@/lib/elevenlabs";

function done(returnTo: string, key: "notice" | "error", message: string): never {
  const safe = returnTo.startsWith("/crm/") || returnTo.startsWith("/portal") ? returnTo : "/";
  revalidatePath(safe.split("?")[0]!);
  redirect(`${safe}${safe.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`);
}

export async function saveReceptionistOptions(receptionistId: string, returnTo: string, form: FormData) {
  const session = await getSession();
  if (!(await canAccessReceptionist(session, receptionistId))) throw new Error("Not allowed");
  let availability;
  try {
    availability = availabilityFromForm(form);
  } catch (err) {
    done(returnTo, "error", (err as Error).message);
  }
  await db.receptionist.update({ where: { id: receptionistId }, data: { ...availability, ...followUpFromForm(form) } });
  await markDirty(receptionistId);
  // Hours, holidays and closed days are read live on every availability lookup; the summary
  // settings change the agent's instructions and tools, so they need a sync.
  done(returnTo, "notice", `Saved. Booking hours apply right away; summary changes go live ${session!.role === "ADMIN" ? "after you sync to ElevenLabs" : "once the team syncs your receptionist (usually same day)"}.`);
}
