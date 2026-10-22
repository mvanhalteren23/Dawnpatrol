import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate, safeJson } from "@/lib/utils";
import { Field, Notice, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { importCsv } from "../../actions";

export const dynamic = "force-dynamic";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ job?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const [job, recent] = await Promise.all([
    sp.job ? db.importJob.findUnique({ where: { id: sp.job } }) : null,
    db.importJob.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const jobErrors = safeJson<{ row: number; message: string }[]>(job?.errors, []);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Bulk upload accounts" subtitle="CSV exports from Apollo, ZoomInfo, Google Maps scrapers, HubSpot or a spreadsheet." />
      <Flash params={sp} />
      {job ? (
        <Notice kind={jobErrors.length ? "info" : "success"}>
          Imported <b>{job.filename}</b>: {job.created} created, {job.updated} updated, {job.skipped} skipped{jobErrors.length ? `, ${jobErrors.length} problems` : ""}.{" "}
          <Link href="/crm/accounts?sort=">View accounts →</Link>
          {jobErrors.length ? <ul className="mt-2 list-disc pl-5 text-xs">{jobErrors.slice(0, 20).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul> : null}
        </Notice>
      ) : null}
      <form action={importCsv} className="card space-y-4">
        <Field label="CSV file"><input type="file" name="file" accept=".csv,text/csv" className="input" required /></Field>
        <Field label="Add tags to every row (comma separated)"><input name="tags" className="input" placeholder="denver-hvac, q4-list" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="updateExisting" defaultChecked /> Fill blanks on accounts that already exist (matched by domain, then name + city)</label>
        <SubmitButton pendingText="Importing…">Upload & import</SubmitButton>
      </form>
      <div className="card mt-6 text-sm">
        <h2 className="mb-2">Recognised columns</h2>
        <p className="text-slate-600">Headers are matched automatically (case and punctuation ignored). One row per contact is fine — rows for the same company are merged.</p>
        <ul className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-600">
          <li><b>Company</b>: name, company, business name</li>
          <li><b>Website</b>: website, url, domain</li>
          <li><b>Phone</b>: phone, company phone</li>
          <li><b>Industry</b>: industry, category, vertical</li>
          <li><b>Location</b>: city, state</li>
          <li><b>Size</b>: employees, headcount</li>
          <li><b>Stage</b>: stage, status (lead, customer…)</li>
          <li><b>Tags / notes</b>: tags, notes</li>
          <li><b>Contact</b>: first name, last name, full name, title</li>
          <li><b>Contact details</b>: email, mobile, linkedin</li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">No website column? The contact&apos;s email domain is used (free-mail domains are ignored).</p>
      </div>
      {recent.length ? (
        <div className="card mt-6">
          <h2 className="mb-2">Recent imports</h2>
          <table className="table"><thead><tr><th>File</th><th>When</th><th>Created</th><th>Updated</th><th>Problems</th></tr></thead>
            <tbody>{recent.map((j) => <tr key={j.id}><td><Link href={`/crm/accounts/import?job=${j.id}`}>{j.filename}</Link></td><td>{formatDate(j.createdAt, true)}</td><td>{j.created}</td><td>{j.updated}</td><td>{safeJson<unknown[]>(j.errors, []).length}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
