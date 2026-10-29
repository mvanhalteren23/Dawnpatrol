import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { companyName } from "@/lib/brand";
import { formatSlot } from "@/lib/booking";
import { AuditReportView } from "@/components/AuditReportView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Call audit report", robots: { index: false, follow: false } };

// The owner's copy of their call audit: numbers, findings and call summaries. No recordings or
// transcripts (those stay in the CRM). The unguessable token in the address is the access check.
export default async function SharedAuditReport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) notFound();
  const audit = await db.callAudit.findUnique({ where: { shareToken: token }, include: { calls: { orderBy: { scheduledAt: "asc" } } } });
  if (!audit || audit.status === "CANCELLED") notFound();
  const company = await companyName();
  return (
    <main className="mx-auto max-w-5xl p-4 md:p-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{company} · Call audit</p>
      <h1 className="mt-1">{audit.businessName}</h1>
      <p className="mb-6 text-sm text-slate-500">
        Test calls to your number over the week of {formatSlot(audit.startsAt, audit.timezone).split(" at ")[0]}, placed as new customers would call, at different times of day.
        {audit.status !== "DONE" ? " The audit is still running; this page updates as calls are made." : ""}
      </p>
      <AuditReportView audit={audit} calls={audit.calls} staff={false} />
    </main>
  );
}
