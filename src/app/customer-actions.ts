"use server";
// Customer texts, bookings and open questions: shared by the CRM and the client portal. Clients
// manage their own receptionist's; the team any it can access.
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canAccessReceptionist } from "@/lib/access";
import { str } from "@/lib/utils";
import { toE164 } from "@/lib/twilio";
import { clampThreshold } from "@/lib/customer-text-rules";

async function guard(receptionistId: string) {
  const session = await getSession();
  if (!(await canAccessReceptionist(session, receptionistId))) throw new Error("Not allowed");
  return session!;
}

function done(returnTo: string, message: string, kind: "notice" | "error" = "notice"): never {
  const safe = returnTo.startsWith("/crm/") || returnTo.startsWith("/portal") ? returnTo : "/";
  revalidatePath(safe.split("?")[0]!);
  redirect(`${safe}${safe.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

export async function saveCustomerTextSettings(receptionistId: string, returnTo: string, form: FormData) {
  await guard(receptionistId);
  const reviewLink = str(form, "reviewLink").trim();
  if (reviewLink && !/^https:\/\/\S+$/.test(reviewLink)) done(returnTo, "The review link should start with https:// (copy it from your Google Business Profile: Ask for reviews).", "error");
  const reviewRequestsOn = form.get("reviewRequestsOn") === "on";
  if (reviewRequestsOn && !reviewLink) done(returnTo, "Add your Google review link to turn on review requests.", "error");
  const phone = str(form, "checkinPhone").trim();
  await db.receptionist.update({
    where: { id: receptionistId },
    data: {
      rescueTextsOn: form.get("rescueTextsOn") === "on",
      smsAgentOn: form.get("smsAgentOn") === "on",
      remindersOn: form.get("remindersOn") === "on",
      reviewRequestsOn,
      reviewLink,
      reviewDelayHours: Math.min(48, Math.max(1, Number(str(form, "reviewDelayHours")) || 3)),
      checkinsOn: form.get("checkinsOn") === "on",
      checkinThreshold: clampThreshold(Number(str(form, "checkinThreshold"))),
      checkinPhone: phone ? toE164(phone) : null,
    },
  });
  done(returnTo, "Saved");
}

/** The client picks their receptionist's voice from the curated list; it's live within a minute. */
export async function chooseVoice(receptionistId: string, returnTo: string, form: FormData) {
  await guard(receptionistId);
  const voiceId = str(form, "voiceId").trim();
  const { isCurated } = await import("@/lib/voices");
  if (!(await isCurated(voiceId))) done(returnTo, "Pick one of the voices listed", "error");
  const r = await db.receptionist.update({ where: { id: receptionistId }, data: { voiceId } });
  if (r.elevenLabsAgentId) {
    const { syncReceptionist } = await import("@/lib/elevenlabs");
    after(() => syncReceptionist(receptionistId).then(() => undefined).catch((e) => console.error("voice sync", e)));
  }
  done(returnTo, "Voice saved. Your receptionist will use it within a minute.");
}

export async function markBookingNoShow(receptionistId: string, bookingId: string, returnTo: string) {
  await guard(receptionistId);
  const b = await db.booking.findUnique({ where: { id: bookingId }, include: { receptionist: true } });
  if (!b || b.receptionistId !== receptionistId) done(returnTo, "Booking not found", "error");
  const { markNoShow } = await import("@/lib/customer-texts");
  const { texted } = await markNoShow(b);
  done(returnTo, texted ? `Marked as a no-show. ${b.customerName} got a text with a link to rebook.` : "Marked as a no-show.");
}

export async function answerOpenQuestion(receptionistId: string, questionId: string, returnTo: string, form: FormData) {
  const session = await guard(receptionistId);
  const answer = str(form, "answer").trim();
  if (!answer) done(returnTo, "Type an answer first", "error");
  const q = await db.openQuestion.findUnique({ where: { id: questionId } });
  if (!q || q.receptionistId !== receptionistId) done(returnTo, "Question not found", "error");
  const { answerQuestions } = await import("@/lib/owner-checkin");
  const res = await answerQuestions(receptionistId, [{ questionId, question: q.question, answer }], { email: session.email, role: session.role, label: session.email });
  done(returnTo, res.closedDays.length ? "Saved, and that day is now closed for bookings." : "Saved. Your receptionist will use it right away.");
}

export async function dismissOpenQuestion(receptionistId: string, questionId: string, returnTo: string) {
  await guard(receptionistId);
  await db.openQuestion.updateMany({ where: { id: questionId, receptionistId }, data: { status: "DISMISSED" } });
  done(returnTo, "Dismissed. If callers keep asking it, it will come back.");
}
