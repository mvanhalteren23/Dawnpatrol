import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { elevenLabsConfigured } from "@/lib/elevenlabs";
import { formatDate } from "@/lib/utils";
import { Field, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { KnowledgeBaseEditor } from "@/components/KnowledgeBaseEditor";
import { TestChat } from "@/components/TestChat";
import { CallList } from "@/components/CallList";
import { googleConnection } from "@/lib/google";
import { AvailabilityFields, FollowUpFields } from "@/components/ReceptionistOptions";
import { syncCallsThrottled } from "@/lib/call-sync";
import { draftKbFromWebsite, previewOpenings, rotateRagToken, syncToElevenLabs, updateBooking, updateReceptionist } from "../../actions";

export const dynamic = "force-dynamic";

export default async function ReceptionistPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string; kbRun?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  await syncCallsThrottled(id);
  const r = await db.receptionist.findUnique({
    where: { id },
    include: { account: true, knowledge: { orderBy: [{ category: "asc" }, { title: "asc" }] }, calls: { orderBy: { startedAt: "desc" }, take: 25 } },
  });
  if (!r) notFound();
  const kbRun = await db.researchRun.findFirst({ where: { kind: "KB_DRAFT", accountId: r.accountId }, orderBy: { createdAt: "desc" } });
  const app = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const returnTo = `/crm/receptionists/${r.id}`;
  const google = await googleConnection();

  return (
    <div>
      <AutoRefresh active={kbRun?.status === "RUNNING"} />
      <PageHeader
        title={`${r.name} — ${r.businessName}`}
        subtitle={<span className="flex items-center gap-2"><Link href={`/crm/accounts/${r.accountId}`}>{r.account.name}</Link><StatusBadge status={r.syncStatus} />{r.lastSyncedAt ? <span className="text-xs text-slate-400">synced {formatDate(r.lastSyncedAt, true)}</span> : null}</span>}
        actions={<>
          <form action={draftKbFromWebsite.bind(null, r.id)}><SubmitButton className="btn-secondary" pendingText="Starting…">Draft KB from website (Claude)</SubmitButton></form>
          <form action={syncToElevenLabs.bind(null, r.id)}><SubmitButton pendingText="Syncing…">Sync to ElevenLabs</SubmitButton></form>
        </>}
      />
      <Flash params={sp} />
      {!elevenLabsConfigured() ? <Notice kind="error">ELEVENLABS_API_KEY is not set — sync is disabled.</Notice> : null}
      {r.syncStatus === "DIRTY" ? <Notice>Knowledge or settings changed since the last sync. Sync to push them to the live agent.</Notice> : null}
      {r.syncError && r.syncStatus === "FAILED" ? <Notice kind="error">Last sync failed: {r.syncError}</Notice> : null}
      {kbRun?.status === "RUNNING" ? <Notice>Claude is reading {r.account.website ?? r.account.domain} and drafting knowledge…</Notice> : null}
      {kbRun?.status === "FAILED" ? <Notice kind="error">KB draft failed: {kbRun.error}</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-2">
          <form action={updateReceptionist.bind(null, r.id)} className="card grid grid-cols-2 gap-3">
            <h2 className="col-span-2">Agent settings</h2>
            <Field label="Receptionist name"><input name="name" defaultValue={r.name} className="input" /></Field>
            <Field label="Business name"><input name="businessName" defaultValue={r.businessName} className="input" /></Field>
            <Field label="Greeting (first message)" className="col-span-2"><input name="greeting" defaultValue={r.greeting} placeholder={`Thanks for calling ${r.businessName}, this is ${r.name}. How can I help?`} className="input" /></Field>
            <Field label="Personality" className="col-span-2"><input name="persona" defaultValue={r.persona} className="input" /></Field>
            <Field label="Business hours" className="col-span-2"><textarea name="businessHours" rows={3} defaultValue={r.businessHours} placeholder={"Mon–Fri 8am–6pm\nSat 9am–1pm\nEmergencies 24/7"} className="input" /></Field>
            <Field label="Timezone"><input name="timezone" defaultValue={r.timezone} className="input" /></Field>
            <Field label="Language"><input name="language" defaultValue={r.language} className="input" /></Field>
            <Field label="Booking link"><input name="bookingUrl" defaultValue={r.bookingUrl ?? ""} className="input" /></Field>
            <Field label="Transfer / escalation phone"><input name="escalationPhone" defaultValue={r.escalationPhone ?? ""} className="input" /></Field>
            <Field label="Escalation rules" className="col-span-2"><textarea name="escalationRules" rows={2} defaultValue={r.escalationRules} className="input" /></Field>
            <Field label="Extra instructions" className="col-span-2"><textarea name="extraInstructions" rows={3} defaultValue={r.extraInstructions} className="input" /></Field>
            <Field label="ElevenLabs voice id"><input name="voiceId" defaultValue={r.voiceId ?? ""} className="input" /></Field>
            <Field label="ElevenLabs agent id"><input name="elevenLabsAgentId" defaultValue={r.elevenLabsAgentId ?? ""} placeholder="created on first sync" className="input" /></Field>
            <Field label="Demo line extension" className="col-span-2"><input name="demoExtension" defaultValue={r.demoExtension ?? ""} placeholder="e.g. 101 — leave blank if this isn't a demo" className="input" inputMode="numeric" /></Field>
            <div className="col-span-2"><SubmitButton pendingText="Saving…">Save settings</SubmitButton></div>
          </form>

          <form action={updateBooking.bind(null, r.id)} className="card grid grid-cols-2 gap-3">
            <h2 className="col-span-2">Calendar booking &amp; caller follow-ups</h2>
            <p className="col-span-2 text-xs text-slate-500">
              {google.connected
                ? <>The agent checks <b>{google.email}</b>&apos;s Google Calendar for openings and books calls into it. To book into a client&apos;s calendar, have them share it with that account (“Make changes to events”) and enter its address below.</>
                : <>Google isn&apos;t connected yet — connect it in <Link href="/crm/settings">Settings</Link>. Until then the agent collects preferred times instead.</>}
            </p>
            <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="bookingEnabled" defaultChecked={r.bookingEnabled} /> Let the agent check availability and book</label>
            <Field label="Appointment name"><input name="bookingTitle" defaultValue={r.bookingTitle} className="input" /></Field>
            <Field label="Calendar"><input name="bookingCalendarId" defaultValue={r.bookingCalendarId} placeholder="primary" className="input" /></Field>
            <AvailabilityFields r={r} />
            <Field label="Length (minutes)"><input name="bookingSlotMinutes" type="number" defaultValue={r.bookingSlotMinutes} className="input" /></Field>
            <Field label="Buffer between (minutes)"><input name="bookingBufferMinutes" type="number" defaultValue={r.bookingBufferMinutes} className="input" /></Field>
            <Field label="Minimum notice (hours)"><input name="bookingMinNoticeHours" type="number" defaultValue={r.bookingMinNoticeHours} className="input" /></Field>
            <Field label="Book up to (days ahead)"><input name="bookingDaysAhead" type="number" defaultValue={r.bookingDaysAhead} className="input" /></Field>
            <Field label="Meeting type" className="col-span-2">
              <select name="bookingMeetingType" defaultValue={r.bookingMeetingType} className="input">
                <option value="phone">Phone call (we call the number they give)</option>
                <option value="google_meet">Google Meet (link in the invite)</option>
                <option value="caller_choice">Caller&apos;s choice (phone or Google Meet)</option>
              </select>
            </Field>
            <FollowUpFields r={r} />
            <Field label="Questions to ask before booking (one per line)" className="col-span-2"><textarea name="bookingQuestions" rows={3} defaultValue={r.bookingQuestions} placeholder="What do your customers usually call about?" className="input" /></Field>
            <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="bookingAddsToCrm" defaultChecked={r.bookingAddsToCrm} /> Add each booking to this CRM: match or create the account, research new ones with Claude, and flag them for review (for your own line)</label>
            <div className="col-span-2 flex gap-2">
              <SubmitButton pendingText="Saving…">Save booking</SubmitButton>
              {google.connected ? <SubmitButton formAction={previewOpenings.bind(null, r.id)} className="btn-secondary" pendingText="Checking…">Preview openings</SubmitButton> : null}
            </div>
          </form>

          <TestChat receptionistId={r.id} greeting={r.greeting || `Thanks for calling ${r.businessName}, this is ${r.name}. How can I help you today?`} />

          <div className="card space-y-3 text-sm">
            <h2>RAG endpoints</h2>
            <p className="text-xs text-slate-500">Send <code>Authorization: Bearer &lt;token&gt;</code>. Add the search endpoint to the ElevenLabs agent as a <b>webhook tool</b> for live lookups; export feeds any Claude workflow.</p>
            <div><div className="label">Search (GET ?q=)</div><code className="block break-all rounded bg-slate-100 p-2 text-xs">{app}/api/rag/{r.id}/search?q=…</code></div>
            <div><div className="label">Export (GET ?format=markdown|json)</div><code className="block break-all rounded bg-slate-100 p-2 text-xs">{app}/api/rag/{r.id}/export</code></div>
            <div><div className="label">Token</div><code className="block break-all rounded bg-slate-100 p-2 text-xs">{r.ragToken}</code></div>
            <form action={rotateRagToken.bind(null, r.id)}><button className="text-xs text-red-600">Rotate token</button></form>
            <div><div className="label">ElevenLabs post-call webhook</div><code className="block break-all rounded bg-slate-100 p-2 text-xs">{app}/api/webhooks/elevenlabs</code><p className="mt-1 text-xs text-slate-500">Optional: calls are also pulled from ElevenLabs automatically, so they log even without the webhook.</p></div>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-3">
          <KnowledgeBaseEditor receptionistId={r.id} items={r.knowledge} returnTo={returnTo} />
          <CallList receptionistId={r.id} calls={r.calls} returnTo={returnTo} />
        </div>
      </div>
    </div>
  );
}
