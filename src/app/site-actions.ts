"use server";
// The public website's enquiry form. Anyone can submit it, so: a hidden honeypot field, a
// minimum time on the page, length limits, and a cap on submissions per hour.
import { after } from "next/server";
import { db } from "@/lib/db";
import { addDays, normalizeDomain, websiteUrl } from "@/lib/utils";
import { recordActivity, sendPlainEmail } from "@/lib/outreach";
import { findDuplicateAccount } from "@/lib/team";
import { companyName } from "@/lib/brand";
import { connectedEmail } from "@/lib/google";
import { researchNewAccounts } from "@/lib/jobs";
import { appBase } from "@/lib/twilio-request";
import { INTERESTS, type Interest } from "@/lib/site";

export type InquiryState = { ok?: boolean; error?: string };

const field = (form: FormData, key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max);

export async function submitInquiry(_prev: InquiryState | undefined, form: FormData): Promise<InquiryState> {
  // Bots fill every field and submit instantly; people don't.
  if (field(form, "company_website", 200)) return { ok: true };
  const started = Number(form.get("started") ?? 0);
  if (!started || Date.now() - started < 3000) return { error: "Please take a moment to fill in the form, then send it again." };

  const name = field(form, "name", 120);
  const email = field(form, "email", 200).toLowerCase();
  const phone = field(form, "phone", 40);
  const business = field(form, "business", 160);
  const website = field(form, "website", 200);
  const message = field(form, "message", 3000);
  const interest = (Object.keys(INTERESTS) as Interest[]).find((k) => k === form.get("interest")) ?? "voice";
  if (!name || !business) return { error: "Add your name and your business name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && phone.replace(/\D/g, "").length < 10) return { error: "Add an email or a phone number so we can reach you." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email address doesn't look right." };

  const recent = await db.activity.count({ where: { source: "website", occurredAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (recent >= 30) return { error: "We're getting a lot of requests right now. Please call us instead, or try again in an hour." };

  const domain = normalizeDomain(website) ?? (email && !/@(gmail|outlook|hotmail|yahoo|icloud|live|shaw|telus)\./.test(email) ? normalizeDomain(email.split("@")[1]) : null);
  // One business, one account: add to the existing one if we already know them.
  const dup = await findDuplicateAccount({ domain, phone, name: business });
  const account = dup
    ? await db.account.update({ where: { id: dup.id }, data: { needsReview: true, reviewReason: `New website enquiry (${INTERESTS[interest]}). Check the notes and follow up.` } })
    : await db.account.create({
        data: {
          name: business,
          domain,
          website: websiteUrl(website || domain),
          phone: phone || null,
          source: "inbound",
          tags: `website,${interest}`,
          needsReview: true,
          reviewReason: `New website enquiry (${INTERESTS[interest]}). Check the notes and follow up.`,
        },
      });
  const [firstName, ...rest] = name.split(/\s+/);
  const contact =
    (email ? await db.contact.findFirst({ where: { accountId: account.id, email } }) : null) ??
    (await db.contact.create({ data: { accountId: account.id, firstName: firstName || null, lastName: rest.join(" ") || null, email: email || null, phone: phone || null, isPrimary: !dup } }));
  const body = [`Interested in: ${INTERESTS[interest]}`, phone ? `Phone: ${phone}` : null, email ? `Email: ${email}` : null, website ? `Website: ${website}` : null, message ? `\n${message}` : null].filter(Boolean).join("\n");
  await recordActivity({ accountId: account.id, contactId: contact.id, type: "NOTE", direction: "INBOUND", subject: `Website enquiry: ${INTERESTS[interest]}`, body, source: "website" });
  await recordActivity({ accountId: account.id, contactId: contact.id, type: "TASK", subject: `Reply to website enquiry from ${name}`, dueAt: addDays(new Date(), 1), source: "website" });

  after(async () => {
    if (!dup) await researchNewAccounts([account.id]).catch((e) => console.warn("enquiry research", e));
    // Tell the owner (or the account's rep) straight away.
    const owner = account.ownerId ? await db.user.findUnique({ where: { id: account.ownerId }, select: { email: true } }) : null;
    const to = owner?.email ?? (await connectedEmail());
    if (to) {
      await sendPlainEmail({
        to,
        subject: `Website enquiry: ${business} (${INTERESTS[interest]})`,
        body: `${name} from ${business} sent an enquiry.\n\n${body}\n\nOpen in the CRM: ${appBase()}/crm/accounts/${account.id}`,
        fromName: await companyName(),
      }).catch((e) => console.warn("enquiry email", e));
    }
  });
  return { ok: true };
}
