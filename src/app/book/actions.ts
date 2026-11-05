"use server";
// The public booking page's form. Anyone with the link can use it, so: a honeypot, a minimum time
// on the page, phone validation and an hourly cap per business. Booking goes through the same
// checks as the phone agent (the slot must still be open).
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { book } from "@/lib/agent-booking";
import { toE164 } from "@/lib/twilio";
import { textCustomer } from "@/lib/customer-texts";

const field = (form: FormData, key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max);

export async function bookFromLink(key: string, form: FormData) {
  const back = (error: string) => redirect(`/book/${key}?error=${encodeURIComponent(error)}${form.get("r") ? `&r=${encodeURIComponent(String(form.get("r")))}` : ""}`);
  const r = await db.receptionist.findUnique({ where: { bookingKey: key } });
  if (!r || !r.bookingEnabled) redirect(`/book/${key}`);
  if (field(form, "company_website", 200)) redirect(`/book/${key}/done`); // bots fill hidden fields
  const started = Number(form.get("started") ?? 0);
  if (!started || Date.now() - started < 3000) back("Please take a moment to fill in the form, then try again.");
  const name = field(form, "name", 120);
  const phone = toE164(field(form, "phone", 40));
  const email = field(form, "email", 200).toLowerCase();
  const slot = field(form, "slot", 40);
  if (!name) back("Add your name.");
  if (phone.replace(/\D/g, "").length < 10) back("Add a phone number with area code.");
  if (!slot) back("Pick a time.");
  const recent = await db.booking.count({ where: { receptionistId: r.id, source: "link", createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (recent >= 20) back("We're getting a lot of bookings right now. Please call us instead.");
  const replaces = field(form, "r", 40);
  const old = replaces ? await db.booking.findUnique({ where: { id: replaces }, select: { receptionistId: true, customerPhone: true } }) : null;
  // Only the customer who made a booking can move it.
  const replacesId = old && old.receptionistId === r.id && old.customerPhone === phone ? replaces : undefined;
  const res = await book(r, { start_iso: slot, caller_name: name, caller_phone: phone, caller_email: email.includes("@") ? email : undefined, summary_method: "text", source: "link", replaces_id: replacesId, notes: "Booked from the online booking link." });
  if (!res.booked) back(res.message.includes("taken") ? "Sorry, that time was just taken. Please pick another." : "That time can't be booked any more. Please pick another.");
  // The page promises a confirmation text: send one if the receptionist's own confirmations are off.
  if (res.confirmation === "none") {
    await textCustomer(r, phone, `${r.businessName}: you're booked for ${r.bookingTitle.toLowerCase()} on ${res.label}. Need to change it? Just reply to this text.`, "confirm").catch((e) => console.error("link confirmation", e));
  }
  redirect(`/book/${key}/done?when=${encodeURIComponent(res.label ?? "")}`);
}
