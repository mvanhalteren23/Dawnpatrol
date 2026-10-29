"use server";
// Receptionist availability and follow-up settings, shared by the CRM and the client portal.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canAccessReceptionist } from "@/lib/access";
import { availabilityFromForm, followUpFromForm, reportFromForm } from "@/lib/booking";
import { ringFromForm } from "@/lib/twilio";
import { markDirty } from "@/lib/elevenlabs";
import { leadAlertFromForm } from "@/lib/follow-up-rules";
import { CARRIERS, forwardingLoop, KEEP_METHODS, LOOP_MESSAGE, PORT_STATUSES, type KeepMethod } from "@/lib/keep-number";
import { dialableNumber } from "@/lib/twilio";

function done(returnTo: string, key: "notice" | "error", message: string): never {
  const safe = returnTo.startsWith("/crm/") || returnTo.startsWith("/portal") ? returnTo : "/";
  revalidatePath(safe.split("?")[0]!);
  redirect(`${safe}${safe.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`);
}

export async function saveReceptionistOptions(receptionistId: string, returnTo: string, form: FormData) {
  const session = await getSession();
  if (!(await canAccessReceptionist(session, receptionistId))) throw new Error("Not allowed");
  let data;
  try {
    data = {
      ...availabilityFromForm(form),
      ...followUpFromForm(form),
      ...(form.has("ringMode") ? ringFromForm(form) : {}),
      ...(form.has("reportFrequency") ? reportFromForm(form) : {}),
      ...(form.has("leadAlertOn") ? leadAlertFromForm(form) : {}),
    };
  } catch (err) {
    done(returnTo, "error", (err as Error).message);
  }
  if ("ringMode" in data) {
    const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, select: { existingNumber: true, keepNumberMethod: true } });
    if (forwardingLoop({ method: r.keepNumberMethod as KeepMethod, existingNumber: r.existingNumber, ringFirstNumber: data.ringFirstNumber ?? null, ringMode: data.ringMode ?? "" })) done(returnTo, "error", LOOP_MESSAGE);
  }
  await db.receptionist.update({ where: { id: receptionistId }, data });
  await markDirty(receptionistId);
  // Hours, holidays and closed days are read live on every availability lookup; the summary
  // settings change the agent's instructions and tools, so they need a sync.
  done(returnTo, "notice", `Saved. Booking hours apply right away; summary changes go live ${session!.role === "ADMIN" ? "after you sync to ElevenLabs" : "once the team syncs your receptionist (usually same day)"}.`);
}

/** "Send it now": email last week's or month's report to the report recipients (even if already sent). */
export async function sendReportNow(receptionistId: string, returnTo: string, form: FormData) {
  const session = await getSession();
  if (!(await canAccessReceptionist(session, receptionistId))) throw new Error("Not allowed");
  const kind = form.get("kind") === "month" ? "month" : "week";
  // A few a day is plenty for checking it works, and keeps the company mailbox from being used to spam.
  const { getSetting, setSetting } = await import("@/lib/settings");
  const key = `report.manual.${receptionistId}.${new Date().toISOString().slice(0, 10)}`;
  const sentToday = Number((await getSetting(key)) ?? 0);
  if (sentToday >= 5) done(returnTo, "error", "That's 5 reports sent today. The next scheduled one will arrive on its own, or try again tomorrow.");
  await setSetting(key, String(sentToday + 1));
  const { sendReport } = await import("@/lib/client-reports");
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId } });
  const res = await sendReport(r, kind, { force: true });
  if (!res.sent) done(returnTo, "error", `Report not sent: ${res.reason}`);
  done(returnTo, "notice", `Last ${kind}'s report sent to ${res.to.join(", ")}`);
}

/**
 * Keep the client's existing number: which number, their phone company, and how (forward missed
 * calls, forward everything, or move it to us). Port progress is updated by admins.
 */
export async function saveKeepNumber(receptionistId: string, returnTo: string, form: FormData) {
  const session = await getSession();
  if (!(await canAccessReceptionist(session, receptionistId))) throw new Error("Not allowed");
  const method = String(form.get("keepNumberMethod") ?? "") as KeepMethod;
  const raw = String(form.get("existingNumber") ?? "").trim();
  const existingNumber = raw ? dialableNumber(raw) : null;
  if (raw && !existingNumber) done(returnTo, "error", "Enter the business number as a Canadian or US number with area code");
  if (method && !existingNumber) done(returnTo, "error", "Enter the number you want to keep");
  const carrier = String(form.get("existingCarrier") ?? "");
  const data: Record<string, unknown> = {
    existingNumber,
    existingCarrier: CARRIERS.some((c) => c.value === carrier) ? carrier : null,
    keepNumberMethod: KEEP_METHODS.some((m) => m.value === method) ? method : "",
  };
  if (session!.role === "ADMIN") {
    const status = String(form.get("portStatus") ?? "");
    const date = String(form.get("portDate") ?? "");
    if (form.has("portStatus")) data.portStatus = PORT_STATUSES.some((p) => p.value === status) ? status : "";
    if (form.has("portDate")) data.portDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : null;
    if (form.has("portNotes")) data.portNotes = String(form.get("portNotes") ?? "").slice(0, 2000);
  } else if (method === "port") {
    data.portStatus = "gathering"; // the team takes it from here
  }
  // Ringing the same number the calls are forwarded from would bounce calls back and forth:
  // switch ring-first off and say so.
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, select: { ringFirstNumber: true, ringMode: true } });
  const loop = forwardingLoop({ method: data.keepNumberMethod as KeepMethod, existingNumber, ringFirstNumber: r.ringFirstNumber, ringMode: r.ringMode });
  if (loop) data.ringMode = "never";
  await db.receptionist.update({ where: { id: receptionistId }, data });
  done(
    returnTo,
    "notice",
    loop
      ? "Saved. Ringing your cell first is now off, because calls already ring that phone before they're forwarded."
      : method === "port"
        ? "Saved. We'll be in touch for the details needed to move your number."
        : "Saved. Follow the steps shown to turn on forwarding.",
  );
}

/** Report schedule and recipients only (the dashboard and Reports page). */
export async function saveReportSettings(receptionistId: string, returnTo: string, form: FormData) {
  const session = await getSession();
  if (!(await canAccessReceptionist(session, receptionistId))) throw new Error("Not allowed");
  let data;
  try {
    data = reportFromForm(form);
  } catch (err) {
    done(returnTo, "error", (err as Error).message);
  }
  await db.receptionist.update({ where: { id: receptionistId }, data });
  done(
    returnTo,
    "notice",
    data.reportFrequency
      ? `Reports will be emailed ${data.reportFrequency === "both" ? "weekly and monthly" : data.reportFrequency} to ${data.reportEmails || "your portal login"}.`
      : "Email reports are off. You can still see them here any time.",
  );
}
