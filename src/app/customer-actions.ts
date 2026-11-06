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
import { recordActivity } from "@/lib/outreach";

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

/** A portal user's own mobile: texting or calling their business line from it unlocks owner updates. */
export async function saveMyMobile(returnTo: string, form: FormData) {
  const session = await getSession();
  if (!session || session.role !== "CLIENT") done(returnTo, "Only portal users set their mobile here", "error");
  const raw = str(form, "phone").trim();
  const { dialableNumber } = await import("@/lib/twilio");
  const phone = raw ? dialableNumber(raw) : null;
  if (raw && !phone) done(returnTo, "Enter your mobile as a 10-digit number", "error");
  await db.user.update({ where: { id: session!.sub }, data: { phone } });
  done(returnTo, phone ? "Saved. Call or text your business line from this number to make changes." : "Mobile removed");
}

/** Undo the latest change made by phone or text (same as replying UNDO). */
export async function undoOwnerChange(receptionistId: string, returnTo: string) {
  await guard(receptionistId);
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId } });
  const { undoLatest } = await import("@/lib/owner-mode");
  done(returnTo, await undoLatest(r));
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


// --- Trusted numbers (call protection): never limited on this line -------------------------

export async function addTrustedNumber(receptionistId: string, returnTo: string, form: FormData) {
  const session = await guard(receptionistId);
  const { dialableNumber } = await import("@/lib/twilio");
  const phone = dialableNumber(str(form, "phone").trim());
  if (!phone) done(returnTo, "Enter a 10-digit Canadian or US number", "error");
  const { trustNumber } = await import("@/lib/call-guard");
  await trustNumber(receptionistId, phone!, str(form, "label").trim(), session.email);
  done(returnTo, `${phone} is trusted: never limited on this line`);
}

export async function trustCaller(receptionistId: string, callId: string, returnTo: string) {
  const session = await guard(receptionistId);
  const call = await db.callLog.findFirst({ where: { id: callId, receptionistId }, select: { callerNumber: true, callerName: true } });
  if (!call?.callerNumber) done(returnTo, "That call has no number to trust", "error");
  const { trustNumber } = await import("@/lib/call-guard");
  const phone = await trustNumber(receptionistId, call!.callerNumber!, call!.callerName ?? "", session.email);
  done(returnTo, `${phone} is trusted: never limited on this line`);
}

export async function removeTrustedNumber(receptionistId: string, id: string, returnTo: string) {
  await guard(receptionistId);
  await db.trustedNumber.deleteMany({ where: { id, receptionistId } });
  done(returnTo, "Removed from trusted numbers");
}


// --- Booking calendar and email branding (Level 0 / Level 3) -----------------------------------

/** Logo, colour, sign-off and reply-to address for emails to this business's callers. */
export async function saveEmailBranding(receptionistId: string, returnTo: string, form: FormData) {
  await guard(receptionistId);
  const { safeColor, safeLogo } = await import("@/lib/email-brand");
  const logo = str(form, "brandLogoUrl").trim();
  const color = str(form, "brandColor").trim();
  const replyTo = str(form, "emailReplyTo").trim().toLowerCase();
  if (logo && !safeLogo(logo)) done(returnTo, "The logo link must start with https://", "error");
  if (replyTo && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(replyTo)) done(returnTo, "Enter a valid reply-to email (or leave it empty)", "error");
  await db.receptionist.update({
    where: { id: receptionistId },
    data: {
      brandLogoUrl: logo ? safeLogo(logo) : null,
      brandColor: color ? safeColor(color, "") || null : null,
      emailSignOff: str(form, "emailSignOff").trim().slice(0, 500),
      emailReplyTo: replyTo || null,
    },
  });
  done(returnTo, "Email branding saved");
}

/** Fill the logo and colour from the business's website. */
export async function brandFromWebsite(receptionistId: string, returnTo: string) {
  await guard(receptionistId);
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, include: { account: { select: { website: true, domain: true } } } });
  const site = r.account.website ?? r.account.domain;
  if (!site) done(returnTo, "Add the business's website to the account first", "error");
  const { fetchBrand } = await import("@/lib/brand-fetch");
  const found = await fetchBrand(site!).catch(() => ({ logoUrl: null, color: null }));
  if (!found.logoUrl && !found.color) done(returnTo, "Couldn't find a logo or colour on the website. Paste a logo link instead.", "error");
  await db.receptionist.update({ where: { id: receptionistId }, data: { ...(found.logoUrl ? { brandLogoUrl: found.logoUrl } : {}), ...(found.color ? { brandColor: found.color } : {}) } });
  done(returnTo, `From the website: ${[found.logoUrl ? "logo" : null, found.color ? "colour" : null].filter(Boolean).join(" and ")}. Check the preview.`);
}

/** Stop using the client's own Google Calendar (access is revoked at Google). */
export async function disconnectCalendar(receptionistId: string, returnTo: string) {
  const session = await guard(receptionistId);
  const { disconnectClientCalendar } = await import("@/lib/google");
  await disconnectClientCalendar(receptionistId);
  const r = await db.receptionist.findUnique({ where: { id: receptionistId }, select: { accountId: true, name: true } });
  if (r) await recordActivity({ accountId: r.accountId, type: "NOTE", source: session.role === "CLIENT" ? "portal" : "system", subject: "Google Calendar disconnected", body: `${session.email} disconnected ${r.name}'s Google Calendar. Bookings now use the built-in calendar.` }).catch(() => undefined);
  done(returnTo, "Calendar disconnected. New bookings use the built-in calendar.");
}

/** The private link the owner's phone calendar subscribes to. */
export async function createCalendarFeed(receptionistId: string, returnTo: string) {
  await guard(receptionistId);
  const { randomBytes } = await import("node:crypto");
  await db.receptionist.update({ where: { id: receptionistId }, data: { calendarFeedToken: randomBytes(24).toString("base64url") } });
  done(returnTo, "Your calendar link is ready below");
}
