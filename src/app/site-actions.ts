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
import { houseFollowupAgent } from "@/lib/house-line";

export type DemoRequestState = { ok?: boolean; error?: string; name?: string; phone?: string; business?: string; callback?: "soon" | "morning" | null; caller?: string };

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
  const followup = form.get("followup") === "on";
  const trade: TradeKey = TRADE_KEYS.find((k) => k === form.get("trade")) ?? "contractors";
  const tradeLabel = INDUSTRIES[trade].tabLabel;
  if (!name || !business) return { error: "Add your name and your business name." };
  if (phone.replace(/\D/g, "").length < 10) return { error: "Add a phone number with area code so we can call you." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email address doesn't look right." };

  const recent = await db.activity.count({ where: { source: "website", occurredAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (recent >= 30) return { error: "We're getting a lot of requests right now. Please try again in an hour." };

  const reviewReason = `Demo request from the website (${tradeLabel}${followup ? " + Follow-Up Agent" : ""}). Call them to book it.`;
  // One business, one account: add to the existing one if we already know them.
  const dup = await findDuplicateAccount({ domain: null, phone, name: business, city: location || null });
  const account = dup
    ? await db.account.update({ where: { id: dup.id }, data: { needsReview: true, reviewReason } })
    : await db.account.create({
        data: { name: business, phone, city: location || null, industry: tradeLabel, source: "inbound", tags: `website,demo,${trade}${followup ? ",followup-agent" : ""}`, needsReview: true, reviewReason },
      });
  const [firstName, ...rest] = name.split(/\s+/);
  const contact =
    (await db.contact.findFirst({ where: { accountId: account.id, OR: [{ phone }, ...(email ? [{ email }] : [])] } })) ??
    (await db.contact.create({ data: { accountId: account.id, firstName: firstName || null, lastName: rest.join(" ") || null, email: email || null, phone, isPrimary: !dup } }));
  const body = [`Trade: ${tradeLabel}`, `Phone: ${phone}`, email ? `Email: ${email}` : null, location ? `Location: ${location}` : null, preferredDate ? `Preferred setup date: ${preferredDate}` : null, followup ? "Also interested in the Follow-Up Agent add-on" : null].filter(Boolean).join("\n");
  await recordActivity({ accountId: account.id, contactId: contact.id, type: "NOTE", direction: "INBOUND", subject: `Website demo request: ${tradeLabel}`, body, source: "website" });
  const { pushForAccount } = await import("@/lib/push");
  await pushForAccount(account.id, { category: "leads", title: `Demo request: ${business}`, body: `${name} (${tradeLabel}${location ? `, ${location}` : ""}) asked for a demo on the website. Call ${phone}.`, tag: `lead:${account.id}` });
  await recordActivity({ accountId: account.id, contactId: contact.id, type: "TASK", subject: `Call ${name} to book their demo${preferredDate ? ` (prefers ${preferredDate})` : ""}`, dueAt: addDays(new Date(), 1), source: "website" });

  // Grace (the follow-up agent) calls them back within a couple of minutes, 8am-8pm Pacific
  // (forms outside those hours are called at 8am).
  const grace = await houseFollowupAgent().catch(() => null);
  let callback: DemoRequestState["callback"] = null;
  if (grace?.elevenLabsAgentId) {
    const { intakeLead, callAfterDelay } = await import("@/lib/followup");
    const intake = await intakeLead(grace, { name, phone, email, business, location, message: `Website demo request (${tradeLabel})${preferredDate ? `, prefers ${preferredDate}` : ""}` }, { source: "website", consent: true }).catch((e) => {
      console.error("demo request follow-up", e);
      return null;
    });
    if (intake?.action === "calling") after(() => callAfterDelay(grace, intake.lead.id));
    callback = intake?.action === "calling" ? "soon" : intake?.action === "queued" ? "morning" : null;
  }

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
  return { ok: true, name, phone, business, callback, caller: grace?.name };
}

// --- "Hear it answer as your business" ---------------------------------------------------
// A prospect gives their business and mobile; we research the business, build a demo receptionist
// in its name and text them the demo number and extension (usually within 15 minutes). Each build
// costs AI research and voice setup, so: honeypot, time on page, consent, one per phone a day and
// a cap per hour.

export type PersonalDemoState = { ok?: boolean; error?: string; name?: string; business?: string; phone?: string; ready?: boolean };

export async function requestPersonalDemo(_prev: PersonalDemoState | undefined, form: FormData): Promise<PersonalDemoState> {
  if (field(form, "company_website", 200)) return { ok: true };
  const started = Number(form.get("started") ?? 0);
  if (!started || Date.now() - started < 3000) return { error: "Please take a moment to fill in the form, then send it again." };
  const { cleanWebsite, demoRequestProblem, DEMO_BUILDS_PER_HOUR, DEMO_BUILDS_PER_PHONE_PER_DAY } = await import("@/lib/demo-request-rules");
  const { dialableNumber } = await import("@/lib/twilio");
  const { normalizeDomain } = await import("@/lib/utils");
  const name = field(form, "name", 120);
  const business = field(form, "business", 160);
  const websiteRaw = field(form, "website", 300);
  const city = field(form, "city", 120);
  const phoneRaw = field(form, "phone", 40);
  const trade: TradeKey = TRADE_KEYS.find((k) => k === form.get("trade")) ?? "contractors";
  const tradeLabel = INDUSTRIES[trade].tabLabel;
  const phone = dialableNumber(phoneRaw);
  const problem = demoRequestProblem({ name, business, website: websiteRaw, city, phone: phoneRaw, consent: form.get("consent") === "on" }, Boolean(phone));
  if (problem || !phone) return { error: problem ?? "Add your mobile number." };
  const website = cleanWebsite(websiteRaw);

  const hourAgo = new Date(Date.now() - 3600_000);
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const [lastHour, samePhone] = await Promise.all([
    db.researchRun.count({ where: { kind: "DEMO_RESEARCH", createdAt: { gte: hourAgo }, input: { contains: '"textTo"' } } }),
    db.researchRun.count({ where: { kind: "DEMO_RESEARCH", createdAt: { gte: dayAgo }, input: { contains: `"textTo":"${phone}"` } } }),
  ]);
  if (samePhone >= DEMO_BUILDS_PER_PHONE_PER_DAY) return { error: "We're already building a demo for this number. Watch for our text, or call our line to hear one now." };
  if (lastHour >= DEMO_BUILDS_PER_HOUR) return { error: "We're building a lot of demos right now. Please try again in an hour, or book a demo time instead." };

  const reviewReason = `Asked on the website to hear their own receptionist (${tradeLabel}). Their demo is being built and texted to them: call them once it's ready.`;
  const domain = normalizeDomain(website);
  const dup = await findDuplicateAccount({ domain, phone, name: business, city: city || null });
  const account = dup
    ? await db.account.update({ where: { id: dup.id }, data: { needsReview: true, reviewReason } })
    : await db.account.create({
        data: { name: business, domain, website, phone, city: city || null, industry: tradeLabel, source: "inbound", tags: `website,hear-it,${trade}`, needsReview: true, reviewReason },
      });
  if (!dup) (await import("@/lib/outreach")).queueEmailBackfill(account.id);
  const [firstName, ...rest] = name.split(/\s+/);
  const contact =
    (await db.contact.findFirst({ where: { accountId: account.id, phone } })) ??
    (await db.contact.create({ data: { accountId: account.id, firstName: firstName || null, lastName: rest.join(" ") || null, phone, isPrimary: !dup } }));
  await recordActivity({
    accountId: account.id,
    contactId: contact.id,
    type: "NOTE",
    direction: "INBOUND",
    subject: "Website: hear it answer as your business",
    body: [`Trade: ${tradeLabel}`, `Mobile: ${phone}`, website ? `Website: ${website}` : null, city ? `Town: ${city}` : null, "Agreed to be texted the demo number and followed up with."].filter(Boolean).join("\n"),
    source: "website",
  });
  await recordActivity({ accountId: account.id, contactId: contact.id, type: "TASK", subject: `Call ${name} after they've heard their demo`, dueAt: addDays(new Date(), 1), source: "website" });

  // A demo agent built for them before: text it straight away.
  const existing = await db.receptionist.findFirst({ where: { accountId: account.id, lifecycle: "demo", demoExtension: { not: null }, elevenLabsAgentId: { not: null } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (existing) {
    const { textDemoReady } = await import("@/lib/demo-research");
    const sent = await textDemoReady(account.id, existing.id, { textTo: phone, textName: name }).catch(() => false);
    return { ok: true, name, business, phone, ready: sent };
  }

  let runId: string;
  try {
    const { startDemoResearch } = await import("@/lib/demo-research");
    runId = await startDemoResearch(account.id, { receptionistId: null, createdById: account.ownerId ?? null, googleUserId: null, bookingEnabled: false, agentName: "Ava", textTo: phone, textName: name });
  } catch (e) {
    console.error("personal demo start", e);
    return { error: "Something went wrong on our side. Please book a demo time instead and we'll set it up with you." };
  }
  after(async () => {
    const { executeDemoResearch } = await import("@/lib/demo-research");
    await executeDemoResearch(runId);
  });
  return { ok: true, name, business, phone };
}
