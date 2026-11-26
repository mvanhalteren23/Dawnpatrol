import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { formatDate, safeJson } from "@/lib/utils";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { CHANNEL_KEYS, LEAD_STATUSES, LEAD_STATUS_LABELS, PAID_CHANNELS, type Channels, type Evidence, type LeadStatus } from "@/lib/prospect-leads-rules";
import { addLeadsToDialer, addLeadsToProspects, dismissLeads, pasteLeads, restoreLead } from "./actions";

export const dynamic = "force-dynamic";

type Search = { status?: string; channel?: string; industry?: string; region?: string; q?: string; min?: string; notice?: string; error?: string };

const STATUS_COLORS: Record<LeadStatus, string> = {
  NEW: "bg-sky-100 text-sky-800",
  PROSPECT: "bg-emerald-100 text-emerald-800",
  DIALER: "bg-violet-100 text-violet-800",
  DISMISSED: "bg-zinc-100 text-zinc-500",
};

function scoreClass(score: number) {
  return score >= 60 ? "bg-emerald-100 text-emerald-800" : score >= 35 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700";
}

export default async function ResearchedLeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  await requireStaff();
  const status = (LEAD_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as LeadStatus) : sp.status === "all" ? null : "NEW";
  const min = Math.max(0, Math.min(100, Number(sp.min) || 0));
  const channel = (CHANNEL_KEYS as string[]).includes(sp.channel ?? "") ? sp.channel! : "";
  const where: Prisma.ProspectLeadWhereInput = {
    ...(status ? { status } : {}),
    ...(min ? { score: { gte: min } } : {}),
    // Channels are stored as JSON text; `"lsa":true` is how the key appears when set.
    ...(channel ? { channels: { contains: `"${channel}":true` } } : {}),
    ...(sp.industry ? { searchIndustry: sp.industry } : {}),
    ...(sp.region ? { searchRegion: sp.region } : {}),
    ...(sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" as const } }, { city: { contains: sp.q, mode: "insensitive" as const } }] } : {}),
  };
  const [leads, counts, industries, regions] = await Promise.all([
    db.prospectLead.findMany({ where, orderBy: [{ score: "desc" }, { lastSeenAt: "desc" }], take: 300 }),
    db.prospectLead.groupBy({ by: ["status"], _count: true }),
    db.prospectLead.findMany({ where: { searchIndustry: { not: "" } }, distinct: ["searchIndustry"], select: { searchIndustry: true }, orderBy: { searchIndustry: "asc" } }),
    db.prospectLead.findMany({ where: { searchRegion: { not: "" } }, distinct: ["searchRegion"], select: { searchRegion: true }, orderBy: { searchRegion: "asc" } }),
  ]);
  const count = (s: LeadStatus) => counts.find((c) => c.status === s)?._count ?? 0;
  const keep = new URLSearchParams(Object.entries({ status: sp.status, channel: sp.channel, industry: sp.industry, region: sp.region, q: sp.q, min: sp.min }).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  const accountIds = leads.map((l) => l.accountId).filter((id): id is string => Boolean(id));
  const accounts = new Map((await db.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, stage: true } })).map((a) => [a.id, a]));

  return (
    <div>
      <PageHeader
        title="Researched leads"
        subtitle={`Businesses found paying for leads · ${count("NEW")} new, ${count("PROSPECT")} in prospects, ${count("DIALER")} on the call list`}
        actions={<Link href="/crm/dialer?list=1" className="btn-secondary">Open call list</Link>}
      />
      <Flash params={sp} />

      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="space-y-1"><span className="label">Status</span>
          <select name="status" defaultValue={status ?? "all"} className="input">
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
            <option value="all">All</option>
          </select>
        </label>
        <label className="space-y-1"><span className="label">Pays for</span>
          <select name="channel" defaultValue={channel} className="input">
            <option value="">Any channel</option>
            {CHANNEL_KEYS.map((k) => <option key={k} value={k}>{PAID_CHANNELS[k].label}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="label">Industry searched</span>
          <select name="industry" defaultValue={sp.industry ?? ""} className="input"><option value="">All</option>{industries.map((i) => <option key={i.searchIndustry}>{i.searchIndustry}</option>)}</select>
        </label>
        <label className="space-y-1"><span className="label">Region searched</span>
          <select name="region" defaultValue={sp.region ?? ""} className="input"><option value="">All</option>{regions.map((r) => <option key={r.searchRegion}>{r.searchRegion}</option>)}</select>
        </label>
        <label className="space-y-1"><span className="label">Min score</span><input name="min" type="number" min={0} max={100} defaultValue={sp.min ?? ""} className="input w-24" /></label>
        <label className="space-y-1"><span className="label">Search</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Name or city" className="input" /></label>
        <button className="btn-secondary">Apply</button>
      </form>

      {leads.length ? (
        <form action={addLeadsToProspects}>
          <input type="hidden" name="keep" value={keep} />
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <SubmitButton pendingText="Adding…">Add to prospects</SubmitButton>
            <SubmitButton formAction={addLeadsToDialer} className="btn-secondary" pendingText="Adding…">Add to call list</SubmitButton>
            <SubmitButton formAction={dismissLeads} className="btn-secondary" pendingText="Dismissing…">Dismiss</SubmitButton>
            <span className="text-xs text-slate-500">Both add options create the account at stage Prospect, with the skill&apos;s company profile when it sent one (otherwise the app researches it). &quot;Call list&quot; also tags it and makes it due today, so it tops the dialer&apos;s Call list.</span>
          </div>
          <div className="card overflow-x-auto p-0">
            <table className="table">
              <thead><tr><th></th><th>Business</th><th>Score</th><th>Pays for</th><th>Evidence and signals</th><th>Status</th></tr></thead>
              <tbody>
                {leads.map((l) => {
                  const ch = safeJson<Channels>(l.channels, {});
                  const evidence = safeJson<Evidence[]>(l.evidence, []);
                  const signals = safeJson<string[]>(l.signals, []);
                  const profile = l.profile ? safeJson<{ research?: { match?: string; report?: string; keyFacts?: string[] } } | null>(l.profile, null) : null;
                  const acct = l.accountId ? accounts.get(l.accountId) : undefined;
                  const actionable = l.status !== "DISMISSED";
                  return (
                    <tr key={l.id} className={l.status === "DISMISSED" ? "opacity-60" : ""}>
                      <td>{actionable ? <input type="checkbox" name="pick" value={l.id} aria-label={`Select ${l.name}`} /> : null}</td>
                      <td>
                        <div className="font-medium">{l.name}</div>
                        <div className="text-xs text-slate-500">
                          {[l.industry ?? l.searchIndustry, [l.city, l.region].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                        </div>
                        <div className="text-xs">
                          {l.website ? <a href={l.website} target="_blank" rel="noreferrer">{l.domain ?? l.website}</a> : null}
                          {l.phone ? <>{l.website ? " · " : ""}<a href={`tel:${l.phone.replace(/[^\d+]/g, "")}`}>{l.phone}</a></> : null}
                        </div>
                        {l.googleRating !== null ? <div className="text-xs text-slate-500">{l.googleRating}★{l.reviewCount !== null ? ` · ${l.reviewCount} reviews` : ""}</div> : null}
                      </td>
                      <td><Badge className={scoreClass(l.score)}>{l.score}</Badge>{l.seenCount > 1 ? <div className="mt-1 text-xs text-slate-500">seen {l.seenCount}×</div> : null}</td>
                      <td>
                        <div className="flex max-w-[14rem] flex-wrap gap-1">
                          {CHANNEL_KEYS.filter((k) => ch[k]).map((k) => <Badge key={k} className="bg-amber-50 text-amber-900">{PAID_CHANNELS[k].short}</Badge>)}
                        </div>
                      </td>
                      <td className="max-w-md text-xs">
                        {signals.length ? <div className="mb-1">{signals.join(" · ")}</div> : null}
                        {evidence.length ? (
                          <details>
                            <summary className="cursor-pointer text-slate-500">{evidence.length} proof {evidence.length === 1 ? "item" : "items"}</summary>
                            <ul className="mt-1 space-y-1">
                              {evidence.map((e, i) => (
                                <li key={i}><span className="font-medium">{e.channel}:</span> {e.note} {e.url ? <a href={e.url} target="_blank" rel="noreferrer">link</a> : null}</li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                        {profile?.research?.report ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-slate-500">
                              Company profile (facts only){profile.research.match === "not_confirmed" ? " · match not confirmed" : ""}
                            </summary>
                            <div className="mt-1 whitespace-pre-wrap">{profile.research.report.slice(0, 3000)}</div>
                          </details>
                        ) : null}
                        {l.notes ? <div className="mt-1 text-slate-500">{l.notes}</div> : null}
                      </td>
                      <td className="text-xs">
                        <Badge className={STATUS_COLORS[l.status as LeadStatus] ?? ""}>{LEAD_STATUS_LABELS[l.status as LeadStatus] ?? l.status}</Badge>
                        {acct ? <div className="mt-1"><Link href={`/crm/accounts/${acct.id}`}>{l.status === "NEW" ? "already in CRM" : "open account"}</Link></div> : null}
                        {l.status === "DISMISSED" ? <div className="mt-1"><button formAction={restoreLead.bind(null, l.id)} className="underline">Restore</button></div> : null}
                        <div className="mt-1 text-slate-500">found {formatDate(l.createdAt)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>
      ) : (
        <Empty>
          No researched leads here yet. Run the prospecting skill in Claude (for example &quot;find plumbers in Squamish paying for leads&quot;), or paste its results below.
        </Empty>
      )}

      <details className="card mt-6">
        <summary className="cursor-pointer font-semibold">Paste leads (JSON)</summary>
        <form action={pasteLeads} className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">
            The research skill posts here automatically. If it couldn&apos;t (or you researched elsewhere), paste the JSON it printed:{" "}
            <code>{`{"search":{"industry":"Plumbing","region":"Squamish, BC"},"leads":[{"name":"…","website":"…","phone":"…","city":"…","channels":{"lsa":true},"evidence":[{"channel":"lsa","note":"…","url":"…"}],"signals":["…"]}]}`}</code>
          </p>
          <textarea name="json" rows={6} className="input font-mono text-xs" required />
          <SubmitButton className="btn-secondary" pendingText="Importing…">Import leads</SubmitButton>
        </form>
      </details>
    </div>
  );
}
