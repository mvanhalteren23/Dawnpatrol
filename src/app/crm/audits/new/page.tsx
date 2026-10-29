import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { dialerCallerId } from "@/lib/dialer";
import { formatPhone } from "@/lib/demo-line";
import { cad, estimateAuditCost, SHOP_DEFAULTS, AUTO_REPAIR_SCENARIOS } from "@/lib/audit-rules";
import { Field, Notice, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { createAudit } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewAuditPage({ searchParams }: { searchParams: Promise<{ account?: string; notice?: string; error?: string }> }) {
  const session = await requireStaff();
  const sp = await searchParams;
  const account = sp.account ? await db.account.findUnique({ where: { id: sp.account } }) : null;
  const accounts = account ? [] : await db.account.findMany({
    where: session.role === "ADMIN" ? {} : { OR: [{ ownerId: session.sub }, { ownerId: null }] },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, name: true },
  });
  const d = SHOP_DEFAULTS.auto_repair;
  const typical = estimateAuditCost(18); // 3 calls × 5 open days + 3 after hours
  const high = estimateAuditCost(18, { answerRate: 1, avgAnsweredMinutes: 4 });
  const caller = dialerCallerId();
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });

  return (
    <div className="max-w-4xl">
      <PageHeader title="New call audit" subtitle="A week of test calls to the business's own number, as customers would make them. Nothing changes on their side." actions={<Link href="/crm/audits" className="btn-secondary">All audits</Link>} />
      <Flash params={sp} />
      {!caller ? <Notice kind="error">No number to call from: set up the dialer number (CRM → Dialer), or enter caller IDs below.</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <form action={createAudit} className="card grid grid-cols-2 gap-3 lg:col-span-3">
          <h2 className="col-span-2">The business</h2>
          {account ? <input type="hidden" name="accountId" value={account.id} /> : (
            <Field label="Account" className="col-span-2">
              <select name="accountId" className="input" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </Field>
          )}
          <Field label="Business name (as they answer)"><input name="businessName" defaultValue={account?.name ?? ""} className="input" /></Field>
          <Field label="Number their customers call"><input name="targetNumber" defaultValue={account?.phone ?? ""} placeholder="604 555 1234" className="input" required /></Field>
          <Field label="Type of business">
            <select name="industry" defaultValue={account?.industry && !/auto|mechanic|repair|garage/i.test(account.industry) ? "other" : "auto_repair"} className="input">
              <option value="auto_repair">Auto repair / mechanic</option>
              <option value="other">Other service business</option>
            </select>
          </Field>
          <Field label="Time zone"><input name="timezone" defaultValue="America/Vancouver" className="input" /></Field>
          <Field label="Their open hours" className="col-span-2"><textarea name="shopHours" rows={2} defaultValue={"Mon-Fri 08:00-17:30"} className="input font-mono text-xs" /></Field>

          <h2 className="col-span-2 pt-2">The calls</h2>
          <Field label="Start date (7 days from)"><input name="startDate" type="date" defaultValue={tomorrow} className="input" /></Field>
          <Field label="Calls per open day (1–5)"><input name="callsPerDay" type="number" min={1} max={5} defaultValue={3} className="input" /></Field>
          <Field label="After-hours calls (0–7)"><input name="afterHoursCalls" type="number" min={0} max={7} defaultValue={3} className="input" /></Field>
          <Field label="Call from (optional, one per line)"><textarea name="callerIds" rows={1} placeholder={caller ? `default ${formatPhone(caller)}` : "+16045551234"} className="input" /></Field>
          <Field label="Extra things to ask about (optional, one per line)" className="col-span-2">
            <textarea name="customScenarios" rows={3} placeholder={"Do you do rust repair? I've got a 2012 Tacoma with rust on the rockers.\nCan you install a trailer hitch on a 2021 Outback?"} className="input" />
          </Field>

          <h2 className="col-span-2 pt-2">For the missed-call estimate</h2>
          <Field label="Calls they get a week"><input name="callsPerWeek" type="number" defaultValue={d.callsPerWeek} className="input" /></Field>
          <Field label="Average job ($)"><input name="avgJobValue" defaultValue={d.avgJobValueCents / 100} className="input" /></Field>
          <Field label="% of calls after hours"><input name="afterHoursPct" type="number" defaultValue={d.afterHoursShare * 100} className="input" /></Field>
          <Field label="% of callers who are new customers"><input name="newCustomerPct" type="number" defaultValue={d.newCustomerShare * 100} className="input" /></Field>
          <Field label="% of new callers who'd book"><input name="bookingPct" type="number" defaultValue={d.bookingRate * 100} className="input" /></Field>

          <h2 className="col-span-2 pt-2">Owner&apos;s agreement</h2>
          <Field label="Who agreed (name and role)" className="col-span-2"><input name="consentName" placeholder="Dave Smith, owner" className="input" required /></Field>
          <label className="col-span-2 flex items-start gap-2 text-sm">
            <input type="checkbox" name="consent" required className="mt-1" />
            <span>The owner agreed to a week of test calls to their number, recorded and analysed, without telling staff which calls are tests. The test caller never books real appointments or gives contact details, and says it&apos;s an automated assistant if asked.</span>
          </label>
          <div className="col-span-2"><SubmitButton pendingText="Planning…">Plan the calls</SubmitButton></div>
        </form>

        <div className="space-y-6 lg:col-span-2">
          <div className="card space-y-2 text-sm">
            <h2>Cost per audit report</h2>
            <p className="text-slate-600">A typical 3-bay mechanic shop (Mon–Fri 8–5:30): 3 calls a day plus 3 after hours = <b>18 calls</b>. If about 65% are answered and last ~3 minutes:</p>
            <table className="w-full">
              <tbody>
                <tr><td>Twilio calls and machine detection</td><td className="text-right tabular-nums">{cad(typical.twilio)}</td></tr>
                <tr><td>ElevenLabs test caller</td><td className="text-right tabular-nums">{cad(typical.elevenLabs)}</td></tr>
                <tr><td>Claude analysis and report</td><td className="text-right tabular-nums">{cad(typical.claude)}</td></tr>
                <tr className="border-t border-slate-200 font-semibold"><td>Total</td><td className="text-right tabular-nums">{cad(typical.total)}</td></tr>
              </tbody>
            </table>
            <p className="text-xs text-slate-500">Most it would reach (every call answered, 4 minutes each): {cad(high.total)}. Uses list rates converted to CAD; check current Twilio and ElevenLabs pricing. Calls from your existing dialer number cost nothing extra; another local number is about CA$1.60 a month. The actual cost of each audit shows on its page.</p>
          </div>
          <div className="card space-y-2 text-sm">
            <h2>What the test caller asks (auto repair)</h2>
            <ul className="list-disc space-y-1 pl-5 text-slate-600">{AUTO_REPAIR_SCENARIOS.map((s) => <li key={s.key}>{s.title}</li>)}</ul>
            <p className="text-xs text-slate-500">One topic per call, rotated, with a different caller name each time. Calls are spread over the morning rush, mid-morning, lunch, afternoon and closing, plus evenings and closed days.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
