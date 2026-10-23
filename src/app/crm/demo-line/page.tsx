import Link from "next/link";
import { db } from "@/lib/db";
import { demoLineConfig, formatPhone } from "@/lib/demo-line";
import { elevenLabsConfigured } from "@/lib/elevenlabs";
import { formatDate } from "@/lib/utils";
import { Badge, Empty, Field, Notice, PageHeader, StageBadge, StatusBadge } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { assignDemoExtension, clearDemoExtension, saveDemoLineSettings } from "../actions";

export const dynamic = "force-dynamic";

export default async function DemoLinePage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const config = await demoLineConfig();
  const [demos, others, demoCalls] = await Promise.all([
    db.receptionist.findMany({
      where: { demoExtension: { not: null } },
      orderBy: { demoExtension: "asc" },
      include: { account: true, _count: { select: { calls: true, knowledge: true } }, calls: { orderBy: { startedAt: "desc" }, take: 1 } },
    }),
    db.receptionist.findMany({ where: { demoExtension: null }, include: { account: true }, orderBy: { updatedAt: "desc" }, take: 50 }),
    db.activity.count({ where: { source: "demo-line", occurredAt: { gte: new Date(Date.now() - 30 * 86400000) } } }),
  ]);
  const app = (process.env.APP_URL ?? "").replace(/\/$/, "");

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Demo line"
        subtitle={<>Prospects call <b>{config.number ? formatPhone(config.number) : "your demo number"}</b>, enter their extension, and hear their own AI receptionist. {demoCalls} demo calls in the last 30 days.</>}
      />
      <Flash params={await searchParams} />
      {!process.env.TWILIO_AUTH_TOKEN ? <Notice kind="error">Set TWILIO_AUTH_TOKEN — the directory rejects calls it can&apos;t verify came from Twilio.</Notice> : null}
      {!elevenLabsConfigured() ? <Notice kind="error">Set ELEVENLABS_API_KEY — it&apos;s needed to hand calls to the demo agents.</Notice> : null}

      <div className="card mb-6 overflow-x-auto p-0">
        {demos.length ? (
          <table className="table">
            <thead><tr><th>Ext</th><th>Prospect</th><th>Receptionist</th><th>Ready?</th><th>Demo calls</th><th>Last call</th><th></th></tr></thead>
            <tbody>{demos.map((r) => (
              <tr key={r.id}>
                <td className="text-lg font-semibold">{r.demoExtension}</td>
                <td><Link href={`/crm/accounts/${r.accountId}`}>{r.account.name}</Link><div><StageBadge stage={r.account.stage} /></div></td>
                <td><Link href={`/crm/receptionists/${r.id}`}>{r.name}</Link><div className="text-xs text-slate-500">{r._count.knowledge} KB items</div></td>
                <td>{r.elevenLabsAgentId ? <StatusBadge status={r.syncStatus} /> : <Badge className="bg-red-100 text-red-800">not synced</Badge>}</td>
                <td>{r._count.calls}</td>
                <td className="text-xs">{formatDate(r.calls[0]?.startedAt, true)}</td>
                <td><form action={clearDemoExtension.bind(null, r.id)}><button className="text-xs text-slate-400 hover:text-red-600">remove</button></form></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="p-5"><Empty>No demos yet. On a prospect&apos;s account, add a receptionist with &quot;Demo for this prospect&quot; ticked, fill its knowledge base (Draft KB from website is fastest), then Sync to ElevenLabs.</Empty></div>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <form action={saveDemoLineSettings} className="card space-y-3">
          <h2>Directory settings</h2>
          <Field label="Greeting"><textarea name="greeting" rows={3} defaultValue={config.greeting === config.defaultGreeting ? "" : config.greeting} placeholder={config.defaultGreeting} className="input" /></Field>
          <Field label="If no valid extension after 3 tries, connect to">
            <select name="fallbackReceptionistId" defaultValue={config.fallbackReceptionistId ?? ""} className="input">
              <option value="">Nobody — say goodbye and hang up</option>
              {[...demos, ...others].filter((r) => r.elevenLabsAgentId).map((r) => <option key={r.id} value={r.id}>{r.name} — {r.account.name}</option>)}
            </select>
          </Field>
          <button className="btn-secondary">Save</button>
        </form>

        <div className="card space-y-3 text-sm">
          <h2>Add an existing receptionist</h2>
          {others.length ? (
            <ul className="divide-y divide-slate-100">
              {others.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <span>{r.name} — <Link href={`/crm/accounts/${r.accountId}`}>{r.account.name}</Link></span>
                  <form action={assignDemoExtension.bind(null, r.id)}><button className="btn-secondary px-2 py-1 text-xs">Give extension</button></form>
                </li>
              ))}
            </ul>
          ) : <p className="text-slate-500">Every receptionist already has an extension.</p>}
        </div>

        <div className="card space-y-2 text-sm lg:col-span-2">
          <h2>One-time setup</h2>
          <ol className="list-decimal space-y-1 pl-5 text-slate-700">
            <li>In the Twilio Console, go to <b>Phone Numbers → Active numbers → {config.number || "the demo number"} → Voice configuration</b>, set <b>A call comes in</b> to Webhook <code>{app}/api/voice/demo</code> (HTTP POST) and save. Enter it exactly — Twilio signs that URL.</li>
            <li>In ElevenLabs <b>Phone Numbers</b>, leave the demo number <b>unassigned</b> (or remove it). Assigning an agent there makes ElevenLabs take the number back from the directory.</li>
            <li>Each demo agent needs a synced receptionist (Sync to ElevenLabs on its page). Calls show up under that receptionist once the ElevenLabs post-call webhook is set.</li>
            <li>Outreach prompts can use <code>{"{{demo_phone}}"}</code> and <code>{"{{demo_extension}}"}</code> — the built-in cold email invites prospects to call their demo.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
