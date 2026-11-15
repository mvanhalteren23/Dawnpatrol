"use server";
import { after } from "next/server";
import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { findDuplicateAccount } from "@/lib/team";
import { researchNewAccounts } from "@/lib/jobs";
import { googleConnection } from "@/lib/google";
import { normalizeDomain, optStr, str, websiteUrl } from "@/lib/utils";

/** Add a business shared from Google Maps or Chrome, research it, and optionally build its demo agent. */
export async function addSharedBusiness(form: FormData) {
  const session = await requireStaff();
  const name = str(form, "name").trim();
  if (!name) redirect(`/crm/share?error=${encodeURIComponent("Add the business name")}`);
  const website = optStr(form, "website");
  const domain = normalizeDomain(website);
  const phone = optStr(form, "phone");
  const city = optStr(form, "city");
  const dup = await findDuplicateAccount({ domain, phone, name, city });
  if (dup) redirect(`/crm/accounts/${dup.id}?error=${encodeURIComponent(`Already in the CRM (${dup.reason}), owned by ${dup.owner}.`)}`);

  const notes = [
    "Added from a share on the phone.",
    optStr(form, "address") ? `Address: ${optStr(form, "address")}` : null,
    optStr(form, "mapsUrl") ? `Google Maps: ${optStr(form, "mapsUrl")}` : null,
    optStr(form, "otherUrl") ? `Also: ${optStr(form, "otherUrl")}` : null,
    optStr(form, "note") ? `Note: ${optStr(form, "note")}` : null,
  ].filter(Boolean).join("\n");
  const account = await db.account.create({
    data: { name, domain, website: websiteUrl(website), phone, city, state: optStr(form, "state"), industry: optStr(form, "industry"), notes, ownerId: session.sub, source: "shared", stage: "PROSPECT" },
  });
  await researchNewAccounts([account.id]);

  if (form.get("buildDemo") === "on") {
    try {
      const mine = await googleConnection(session.sub);
      const { startDemoResearch, executeDemoResearch } = await import("@/lib/demo-research");
      const runId = await startDemoResearch(account.id, { receptionistId: null, createdById: session.sub, googleUserId: mine.connected ? session.sub : null, bookingEnabled: mine.calendar, agentName: "Ava" });
      after(() => executeDemoResearch(runId));
      redirect(`/crm/accounts/${account.id}?notice=${encodeURIComponent("Added. Researching the business and building their demo agent (a few minutes).")}`);
    } catch (err) {
      unstable_rethrow(err);
      redirect(`/crm/accounts/${account.id}?error=${encodeURIComponent(`Added, but the demo agent couldn't start: ${(err as Error).message}`)}`);
    }
  }
  redirect(`/crm/accounts/${account.id}?notice=${encodeURIComponent("Added. The business is being researched to fill in the details.")}`);
}
