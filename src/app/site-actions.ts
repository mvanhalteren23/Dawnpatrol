"use server";
// The public website's "Book a demo" form. Anyone can submit it, so: a hidden honeypot field, a
// minimum time on the page, length limits, and a cap on submissions per hour.
import { after } from "next/server";
import { db } from "@/lib/db";
import { addDays } from "@/lib/utils";
import { recordActivity, sendPlainEmail } from "@/lib/outreach";
import { findDuplicateAccount } from "@/lib/team";
import { companyName } from "@/lib/brand";
import { connectedEmail } from "@/lib/google";
import { researchNewAccounts } from "@/lib/jobs";
import { appBase } from "@/lib/twilio-request";
import { INDUSTRIES, TRADE_KEYS, type TradeKey } from "@/lib/site-content";

export type DemoRequestState = { ok?: boolean; error?: string; name?: string; phone?: string; business?: string };

const field = (form: FormData, key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max);

export async function submitDemoRequest(_prev: DemoRequestState | undefined, form: FormData): Promise<DemoRequestState> {
  // Bots fill every field and submit instantly; people don't.
  if (field(form, "company_website", 200)) return { ok: true };
  const started = Number(form.get("started") ?? 0);
  if (!started || Date.now() - started < 3000) return { error: "Please take a moment to fill in the form, then send it again." };

  const name = field(form, "name", 120);
  const business = field(form, "business", 160);
  const phone = field(form, "phone", 40);
  const email = field(form, "email", 200).toLowerCase();
  const location = field(form, "location", 120);
  const preferredDate = field(form, "preferredDate", 20);
  const trade: TradeKey = TRADE_KEYS.find((k) => k === form.get("trade")) ?? "contractors";
  const tradeLabel = INDUSTRIES[trade].tabLabel;
  if (!name || !business) return { error: "Add your name and your business name." };
  if (phone.replace(/\D/g, "").length < 10) return { error: "Add a phone number with area code so we can call you." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email address doesn't look right." };

  const recent = await db.activity.count({ where: { source: "website", occurredAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (recent >= 30) return { error: "We're getting a lot of requests right now. Please try again in an hour." };

  const reviewReason = `Demo request from the website (${tradeLabel}). Call them to book it.`;
  // One business, one account: add to the existing one if we already know them.
  const dup = await findDuplicateAccount({ domain: null, phone, name: business, city: location || null });
  const account = dup
    ? await db.account.update({ where: { id: dup.id }, data: { needsReview: true, reviewReason } })
    : await db.account.create({
        data: { name: business, phone, city: location || null, industry: tradeLabel, source: "inbound", tags: `website,demo,${trade}`, needsReview: true, reviewReason },
      });
  const [firstName, ...rest] = name.split(/\s+/);
  const contact =
    (await db.contact.findFirst({ where: { accountId: account.id, OR: [{ phone }, ...(email ? [{ email }] : [])] } })) ??
    (await db.contact.create({ data: { accountId: account.id, firstName: firstName || null, lastName: rest.join(" ") || null, email: email || null, phone, isPrimary: !dup } }));
  const body = [`Trade: ${tradeLabel}`, `Phone: ${phone}`, email ? `Email: ${email}` : null, location ? `Location: ${location}` : null, preferredDate ? `Preferred setup date: ${preferredDate}` : null].filter(Boolean).join("\n");
  await recordActivity({ accountId: account.id, contactId: contact.id, type: "NOTE", direction: "INBOUND", subject: `Website demo request: ${tradeLabel}`, body, source: "website" });
  await recordActivity({ accountId: account.id, contactId: contact.id, type: "TASK", subject: `Call ${name} to book their demo${preferredDate ? ` (prefers ${preferredDate})` : ""}`, dueAt: addDays(new Date(), 1), source: "website" });

  after(async () => {
    if (!dup) await researchNewAccounts([account.id]).catch((e) => console.warn("demo request research", e));
    // Sales: tell the account's rep, or the company account (matt@), straight away.
    const owner = account.ownerId ? await db.user.findUnique({ where: { id: account.ownerId }, select: { email: true } }) : null;
    const to = owner?.email ?? (await connectedEmail());
    if (to) {
      await sendPlainEmail({
        to,
        subject: `Demo request: ${business} (${tradeLabel})`,
        body: `${name} from ${business} asked for a demo.\n\n${body}\n\nOpen in the CRM: ${appBase()}/crm/accounts/${account.id}`,
        fromName: await companyName(),
      }).catch((e) => console.warn("demo request email", e));
    }
  });
  return { ok: true, name, phone, business };
}
