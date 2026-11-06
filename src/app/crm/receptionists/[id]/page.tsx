import { appUrl } from "@/lib/app-url";
import { requireStaff } from "@/lib/auth";
import { canAccessReceptionist } from "@/lib/access";
import { KeepNumberCard } from "@/components/KeepNumberCard";
import { demoLineConfig, formatPhone } from "@/lib/demo-line";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { elevenLabsConfigured } from "@/lib/elevenlabs";
import { formatDate } from "@/lib/utils";
import { Badge, Field, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { KnowledgeBaseEditor } from "@/components/KnowledgeBaseEditor";
import { KbHistory } from "@/components/KbHistory";
import { kbHistory } from "@/lib/kb-history";
import { TestChat } from "@/components/TestChat";
import { CallList } from "@/components/CallList";
import { googleConnection } from "@/lib/google";
import { AvailabilityFields, FollowUpFields, LeadAlertFields, RingFields } from "@/components/ReceptionistOptions";
import { syncCallsThrottled } from "@/lib/call-sync";
import { FollowupSettingsCard, WebsiteFormCard } from "@/components/FollowupCards";
import { LeadList } from "@/components/LeadList";
import { followupOpening } from "@/lib/followup-rules";
import { applyTemplateAction, createKbReviewLink, revokeKbReviewLink, resetCallGuard, saveCallGuard, draftKbFromWebsite, getBusinessLine, previewOpenings, promoteDemo, removeBusinessLine, reviveDemoAction, saveRingSettings, rotateRagToken, syncToElevenLabs, updateBooking, updateReceptionist } from "../../actions";
import { demoExpiry } from "@/lib/agent-lifecycle";
import { VoiceOptions } from "@/components/VoicePicker";
import { curatedVoices } from "@/lib/voices";
import { AGENT_TEMPLATES, TEMPLATE_KEYS, templateFor } from "@/lib/agent-templates";
import { BookingsList, CustomerTextSettings, OpenQuestions } from "@/components/CustomerCare";
import { bookingLink, textsCustomers } from "@/lib/customer-texts";

export const dynamic = "force-dynamic";

export default async function ReceptionistPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string; kbRun?: string }> }) {
  const session = await requireStaff();
  const isAdmin = session.role === "ADMIN";
  const { id } = await params;
  const sp = await searchParams;
  if (!(await canAccessReceptionist(session, id))) notFound();
  await syncCallsThrottled(id);
  const r = await db.receptionist.findUnique({
    where: { id },
    include: { account: true, knowledge: { orderBy: [{ category: "asc" }, { title: "asc" }] }, calls: { orderBy: { startedAt: "desc" }, take: 25 } },
  });
  if (!r) notFound();
  const followup = r.agentType === "followup";
  const leads = followup ? await db.lead.findMany({ where: { receptionistId: r.id }, orderBy: { createdAt: "desc" }, take: 30 }) : [];
  const kbRun = await db.researchRun.findFirst({ where: { kind: "KB_DRAFT", accountId: r.accountId }, orderBy: { createdAt: "desc" } });
  const app = appUrl();
  const [reviewLinks, reviewContact] = await Promise.all([
    db.kbReviewLink.findMany({ where: { receptionistId: r.id }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.contact.findFirst({ where: { accountId: r.accountId, email: { not: null } }, orderBy: { isPrimary: "desc" }, select: { email: true } }),
  ]);
  const reviewEmail = reviewContact?.email ?? null;
  const returnTo = `/crm/receptionists/${r.id}`;
  // The Google account this receptionist books into: a person's own, or the company account.
  const google = await googleConnection(r.googleUserId);
  const calendarOwners = isAdmin
    ? await db.user.findMany({ where: { role: { in: ["ADMIN", "REP"] }, disabled: false, google: { isNot: null } }, select: { id: true, name: true, email: true } })
    : (await googleConnection(session.sub)).connected ? [{ id: session.sub, name: "You", email: session.email }] : [];
  const { number: demoNumber } = await demoLineConfig();
  const expiresAt = r.lifecycle === "demo" ? (await demoExpiry([r])).get(r.id) ?? null : null;
  const promotedTo = r.lifecycle !== "production" ? await db.receptionist.findFirst({ where: { promotedFromId: r.id }, select: { id: true, name: true } }) : null;
  const promotedFrom = r.promotedFromId ? await db.receptionist.findUnique({ where: { id: r.promotedFromId }, select: { id: true, name: true } }) : null;
  const canPromote = isAdmin && r.lifecycle !== "production" && r.agentType === "inbound" && !promotedTo;
  const customerCare = textsCustomers(r);
  const voiceList = await curatedVoices();
  const [careLink, openQs, recentBookings] = customerCare
    ? await Promise.all([
        bookingLink(r).catch(() => null),
        db.openQuestion.findMany({ where: { receptionistId: r.id, status: "OPEN" }, orderBy: [{ kind: "desc" }, { askedCount: "desc" }] }),
        db.booking.findMany({ where: { receptionistId: r.id, start: { gte: new Date(Date.now() - 14 * 86400_000) } }, orderBy: { start: "desc" }, take: 30 }),
      ])
    : [null, [], []];

  return (
    <div>
      <AutoRefresh active={kbRun?.status === "RUNNING"} />
      <PageHeader
        title={`${r.name} — ${r.businessName}`}
        subtitle={<span className="flex items-center gap-2"><Link href={`/crm/accounts/${r.accountId}`}>{r.account.name}</Link><Badge className={r.lifecycle === "production" ? "bg-emerald-100 text-emerald-800" : r.lifecycle === "demo" ? "bg-sky-100 text-sky-800" : "bg-slate-200 text-slate-600"}>{r.lifecycle === "production" ? "Production" : r.lifecycle === "demo" ? "Demo" : "Expired demo"}</Badge><StatusBadge status={r.syncStatus} />{r.lastSyncedAt ? <span className="text-xs text-slate-400">synced {formatDate(r.lastSyncedAt, true)}</span> : null}</span>}
        actions={<>
          <form action={draftKbFromWebsite.bind(null, r.id)}><SubmitButton className="btn-secondary" pendingText="Starting…">Draft KB from website (Claude)</SubmitButton></form>
          {r.lifecycle === "expired"
            ? <form action={reviveDemoAction.bind(null, r.id)}><SubmitButton pendingText="Reviving…">Revive demo</SubmitButton></form>
            : <form action={syncToElevenLabs.bind(null, r.id)}><SubmitButton pendingText="Syncing…">Sync to ElevenLabs</SubmitButton></form>}
          {canPromote ? <form action={promoteDemo.bind(null, r.id)}><SubmitButton className="btn-secondary" pendingText="Promoting…">Promote to production</SubmitButton></form> : null}
        </>}
      />
      <Flash params={sp} />
      {r.demoExtension ? <Notice kind="success">Demo: call <b>{demoNumber ? formatPhone(demoNumber) : "the demo line"}</b> and enter extension <b>{r.demoExtension}</b> to hear {r.name} answer for {r.businessName}. Send the prospect the same number and extension.</Notice> : null}
      {r.lifecycle === "demo" ? <Notice>{expiresAt ? <>Demo agent: if nobody calls it or changes it, it&apos;s removed from ElevenLabs on <b>{formatDate(expiresAt)}</b> (settings and knowledge stay here and it can be revived).</> : <>Demo agent: kept while {r.account.name} is an active deal.</>}{promotedTo ? <> Promoted to <Link href={`/crm/receptionists/${promotedTo.id}`}>{promotedTo.name} (production)</Link>.</> : canPromote ? " When they sign, Promote to production gives them a fresh production agent with this demo's settings and knowledge." : ""}</Notice> : null}
      {r.lifecycle === "expired" ? <Notice>This demo expired {r.expiredAt ? formatDate(r.expiredAt) : ""}: it was removed from ElevenLabs and the demo line. Its settings and knowledge are kept. Revive it to put it back on the demo line with a new extension.{promotedTo ? <> The client&apos;s production agent is <Link href={`/crm/receptionists/${promotedTo.id}`}>{promotedTo.name}</Link>.</> : null}</Notice> : null}
      {promotedFrom ? <Notice kind="success">Production agent, promoted from the demo <Link href={`/crm/receptionists/${promotedFrom.id}`}>{promotedFrom.name}</Link>.</Notice> : null}
      {!elevenLabsConfigured() ? <Notice kind="error">ELEVENLABS_API_KEY is not set — sync is disabled.</Notice> : null}
      {r.syncStatus === "DIRTY" ? <Notice>Knowledge or settings changed since the last sync. Sync to push them to the live agent.</Notice> : null}
      {r.syncError && r.syncStatus === "FAILED" ? <Notice kind="error">Last sync failed: {r.syncError}</Notice> : null}
      {kbRun?.status === "RUNNING" ? <Notice>Claude is reading {r.account.website ?? r.account.domain} and drafting knowledge…</Notice> : null}
      {kbRun?.status === "FAILED" ? <Notice kind="error">KB draft failed: {kbRun.error}</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-2">
          {customerCare ? <CustomerTextSettings r={r} returnTo={returnTo} bookingLink={careLink} /> : null}
          {r.agentType === "inbound" || r.agentType === "followup" ? (
            <form action={applyTemplateAction.bind(null, r.id)} className="card space-y-2 text-sm">
              <h2>Template</h2>
              <p className="text-xs text-slate-500">Fills in blank settings and adds missing starter knowledge (payment, recording and emergency policies, plus TO FILL IN entries). It never overwrites what&apos;s already set. Safety rules are always built in.</p>
              <div className="flex gap-2">
                <select name="template" defaultValue={templateFor(r.account.industry, r.agentType).key} className="input">{TEMPLATE_KEYS.map((k) => <option key={k} value={k}>{AGENT_TEMPLATES[k].label}</option>)}</select>
                <button className="btn-secondary whitespace-nowrap">Apply template</button>
              </div>
            </form>
          ) : null}
          <form action={updateReceptionist.bind(null, r.id)} className="card grid grid-cols-2 gap-3">
            <h2 className="col-span-2">Agent settings</h2>
            <Field label="Receptionist name"><input name="name" defaultValue={r.name} className="input" /></Field>
            <Field label="Business name"><input name="businessName" defaultValue={r.businessName} className="input" /></Field>
            {followup ? <input type="hidden" name="greeting" value={r.greeting} /> : <Field label="Greeting (first message)" className="col-span-2"><input name="greeting" defaultValue={r.greeting} placeholder={`Thanks for calling ${r.businessName}, this is ${r.name}. How can I help?`} className="input" /></Field>}
            <Field label="Personality" className="col-span-2"><input name="persona" defaultValue={r.persona} className="input" /></Field>
            <Field label="Business hours" className="col-span-2"><textarea name="businessHours" rows={3} defaultValue={r.businessHours} placeholder={"Mon–Fri 8am–6pm\nSat 9am–1pm\nEmergencies 24/7"} className="input" /></Field>
            <Field label="Timezone"><input name="timezone" defaultValue={r.timezone} className="input" /></Field>
            <Field label="Language"><input name="language" defaultValue={r.language} className="input" /></Field>
            <Field label="Booking link"><input name="bookingUrl" defaultValue={r.bookingUrl ?? ""} className="input" /></Field>
            <Field label="Transfer / escalation phone"><input name="escalationPhone" defaultValue={r.escalationPhone ?? ""} className="input" /></Field>
            <Field label="Escalation rules" className="col-span-2"><textarea name="escalationRules" rows={2} defaultValue={r.escalationRules} className="input" /></Field>
            <Field label="Extra instructions" className="col-span-2"><textarea name="extraInstructions" rows={3} defaultValue={r.extraInstructions} className="input" /></Field>
            <Field label="Voice" className="col-span-2"><VoiceOptions voices={voiceList} current={r.voiceId} allowCustom /></Field>
            {isAdmin ? <Field label="ElevenLabs agent id"><input name="elevenLabsAgentId" defaultValue={r.elevenLabsAgentId ?? ""} placeholder="created on first sync" className="input" /></Field> : null}
            {followup ? null : <Field label="Demo line extension" className="col-span-2"><input name="demoExtension" defaultValue={r.demoExtension ?? ""} placeholder="e.g. 101 — leave blank if this isn't a demo" className="input" inputMode="numeric" /></Field>}
            <div className="col-span-2"><SubmitButton pendingText="Saving…">Save settings</SubmitButton></div>
          </form>

          {followup ? <FollowupSettingsCard r={r} /> : null}
          {followup ? <WebsiteFormCard r={r} app={app} isAdmin={isAdmin} /> : null}

          <form action={updateBooking.bind(null, r.id)} className="card grid grid-cols-2 gap-3">
            <h2 className="col-span-2">{followup ? "Calendar booking" : <>Calendar booking &amp; caller follow-ups</>}</h2>
            <p className="col-span-2 text-xs text-slate-500">
              {google.connected
                ? <>The agent checks <b>{google.email}</b>&apos;s Google Calendar for openings and books calls into it. To book into a client&apos;s calendar, have them share it with that account (“Make changes to events”) and enter its address below.</>
                : <>{r.googleUserId ? "That person's" : "The company"} Google account isn&apos;t connected — connect it in <Link href="/crm/settings">Settings</Link>. Until then the agent collects preferred times instead.</>}
            </p>
            <Field label="Book into whose Google account" className="col-span-2">
              <select name="bookingGoogle" defaultValue={r.googleUserId ?? ""} className="input">
                {isAdmin ? <option value="">Company Google account</option> : r.googleUserId !== session.sub ? <option value={r.googleUserId ?? ""}>{r.googleUserId ? "Another person's calendar" : "Company Google account"} (only an admin can change)</option> : null}
                {calendarOwners.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}{u.id === session.sub ? " (your calendar)" : ""}</option>)}
              </select>
            </Field>
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
            <LeadAlertFields r={r} />
            <Field label="Questions to ask before booking (one per line)" className="col-span-2"><textarea name="bookingQuestions" rows={3} defaultValue={r.bookingQuestions} placeholder="What do your customers usually call about?" className="input" /></Field>
            {isAdmin ? <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="bookingAddsToCrm" defaultChecked={r.bookingAddsToCrm} /> Add each booking to this CRM: match or create the account, research new ones with Claude, and flag them for review (for your own line)</label> : null}
            <div className="col-span-2 flex gap-2">
              <SubmitButton pendingText="Saving…">Save booking</SubmitButton>
              {google.connected ? <SubmitButton formAction={previewOpenings.bind(null, r.id)} className="btn-secondary" pendingText="Checking…">Preview openings</SubmitButton> : null}
            </div>
          </form>

          {isAdmin ? <div className="card space-y-3">
            <h2>Business line</h2>
            {r.businessNumber ? (
              <>
                {followup ? <p className="text-xs text-slate-500">{r.name} calls leads from this number and texts them from it when they miss the call. Calls back to it ring the client first.</p> : null}
                <p className="text-sm">Calls to <b>{r.businessNumber}</b> ring {r.ringFirstNumber ?? "nobody"} first{r.ringMode === "hours" ? " during bookable hours" : r.ringMode === "never" ? " — ringing is off, the receptionist answers every call" : ""}, then go to {r.name}. Texts are forwarded to the cell.</p>
                <form action={saveRingSettings.bind(null, r.id)} className="grid grid-cols-2 gap-3">
                  <RingFields r={r} />
                  <div className="col-span-2"><SubmitButton pendingText="Saving…">Save line settings</SubmitButton></div>
                </form>
                <form action={removeBusinessLine.bind(null, r.id)} className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs">
                  <label className="flex items-center gap-1"><input type="checkbox" name="release" /> Also release the number to Twilio (permanent)</label>
                  <button className="text-red-600">Remove business line</button>
                </form>
              </>
            ) : (
              <form action={getBusinessLine.bind(null, r.id)} className="grid grid-cols-2 gap-3">
                <p className="col-span-2 text-xs text-slate-500">Gives the client a new local number to publish. Each call rings their cell first (with &ldquo;press 1 to answer&rdquo; so their voicemail can&apos;t take it), then {r.name} answers. Needs the ElevenLabs agent synced, and costs a Twilio number plus per-minute charges for both legs while the cell rings.</p>
                <RingFields r={r} />
                <Field label="Area code for the new number"><input name="areaCode" defaultValue={(r.ringFirstNumber ?? "").replace(/\D/g, "").slice(-10, -7) || "604"} className="input" inputMode="numeric" maxLength={3} /></Field>
                <Field label="…or use a number already on Twilio"><input name="existingNumber" placeholder="+16045551234" className="input" /></Field>
                <div className="col-span-2"><SubmitButton pendingText="Setting up…">Get business line</SubmitButton></div>
              </form>
            )}
          </div> : null}

          {isAdmin && !r.demoExtension && !followup ? <KeepNumberCard r={r} returnTo={returnTo} admin /> : null}
          {!r.demoExtension && !followup ? <Link href={`/portal/reports?account=${r.accountId}`} className="btn-secondary w-fit">Client&apos;s call reports →</Link> : null}

          <div className="card space-y-3 text-sm">
            <h2>Client review link</h2>
            <p className="text-xs text-slate-500">Send the client a private link (no login) to check and complete {r.name}&apos;s knowledge: fill the &ldquo;TO FILL IN&rdquo; gaps, confirm the &ldquo;(assumed)&rdquo; answers, keep or remove website drafts, edit anything, and add what&apos;s missing. Changes save as they go and appear in History (undo any of them). Lasts 30 days.</p>
            <form action={createKbReviewLink.bind(null, r.id)} className="flex flex-wrap gap-2">
              <input name="email" type="email" defaultValue={reviewEmail ?? ""} placeholder="Client's email (or leave empty to copy the link)" className="input min-w-[16rem] flex-1" aria-label="Client's email" />
              <SubmitButton className="btn whitespace-nowrap" pendingText="…">Create link</SubmitButton>
            </form>
            {reviewLinks.length ? (
              <ul className="space-y-2">
                {reviewLinks.map((l) => {
                  const state = l.revokedAt ? "off" : l.expiresAt < new Date() ? "expired" : "active";
                  return (
                    <li key={l.id} className="rounded-[10px] border border-slate-200 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <span>{formatDate(l.createdAt, true)}{l.sentTo ? ` · emailed to ${l.sentTo}` : ""} · {l.lastOpenedAt ? `opened ${formatDate(l.lastOpenedAt, true)}` : "not opened yet"} · {l.changes} change{l.changes === 1 ? "" : "s"}{l.finishedAt ? " · finished" : ""}</span>
                        <span className="flex items-center gap-2"><Badge className={state === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}>{state}</Badge>{state === "active" ? <form action={revokeKbReviewLink.bind(null, r.id, l.id)}><button className="underline">Turn off</button></form> : null}</span>
                      </div>
                      {state === "active" ? <input readOnly value={`${app}/review/${l.token}`} className="input mt-1 py-1 text-xs" aria-label="Review link" /> : null}
                      {l.finishNote ? <p className="mt-1 text-xs">Client&apos;s note: &ldquo;{l.finishNote}&rdquo;</p> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <form action={saveCallGuard.bind(null, r.id)} className="card space-y-3 text-sm">
            <div className="flex items-center justify-between"><h2>Call protection</h2>{r.guardTrippedAt ? <Badge className="bg-red-100 text-red-800">paused: voicemail</Badge> : <Badge className="bg-emerald-100 text-emerald-800">normal</Badge>}</div>
            {r.guardTrippedAt ? <Notice kind="error">Since {formatDate(r.guardTrippedAt, true)}, new calls go to a 2-minute voicemail: {r.guardReason}. Check the calls below, block any abusive numbers, then reset.</Notice> : null}
            <p className="text-xs text-slate-500">Stops anyone burning minutes. Callers over their limit hear a short message; past the daily line limit (or 3x a usual day) calls go to voicemail and the team is alerted.{r.demoExtension || r.bookingAddsToCrm ? " The demo line also caps each caller at 3 calls and 2 calls at once." : ""}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max call length (minutes)"><input name="maxCallMinutes" type="number" min={2} max={60} defaultValue={r.maxCallMinutes} className="input" /></Field>
              <Field label="Hang up after silence (seconds)"><input name="silenceHangupSeconds" type="number" min={10} max={120} defaultValue={r.silenceHangupSeconds} className="input" /></Field>
              <Field label="Calls per caller per day"><input name="callerDailyCalls" type="number" min={1} max={50} defaultValue={r.callerDailyCalls} className="input" /></Field>
              <Field label="Minutes per caller per day"><input name="callerDailyMinutes" type="number" min={5} max={240} defaultValue={r.callerDailyMinutes} className="input" /></Field>
              <Field label="Line minutes per day"><input name="lineDailyMinutes" type="number" min={20} max={3000} defaultValue={r.lineDailyMinutes} className="input" /></Field>
              <Field label="Calls at the same time"><input name="maxConcurrentCalls" type="number" min={1} max={20} defaultValue={r.maxConcurrentCalls} className="input" /></Field>
            </div>
            <div className="flex gap-2">
              <SubmitButton className="btn-secondary">Save protection</SubmitButton>
              {r.guardTrippedAt ? <button formAction={resetCallGuard.bind(null, r.id)} className="btn">Reset: back to normal</button> : null}
            </div>
          </form>

          <TestChat receptionistId={r.id} greeting={followup ? followupOpening(r).replace(/\{\{lead_first_name\}\}/g, "Dana") : r.greeting || `Thanks for calling ${r.businessName}, this is ${r.name}. How can I help you today?`} />

          {isAdmin ? <div className="card space-y-3 text-sm">
            <h2>RAG endpoints</h2>
            <p className="text-xs text-slate-500">Send <code>Authorization: Bearer &lt;token&gt;</code>. Add the search endpoint to the ElevenLabs agent as a <b>webhook tool</b> for live lookups; export feeds any Claude workflow.</p>
            <div><div className="label">Search (GET ?q=)</div><code className="block break-all rounded bg-slate-100 p-2 text-xs">{app}/api/rag/{r.id}/search?q=…</code></div>
            <div><div className="label">Export (GET ?format=markdown|json)</div><code className="block break-all rounded bg-slate-100 p-2 text-xs">{app}/api/rag/{r.id}/export</code></div>
            <div><div className="label">Token</div><code className="block break-all rounded bg-slate-100 p-2 text-xs">{r.ragToken}</code></div>
            <form action={rotateRagToken.bind(null, r.id)}><button className="text-xs text-red-600">Rotate token</button></form>
            <div><div className="label">ElevenLabs post-call webhook</div><code className="block break-all rounded bg-slate-100 p-2 text-xs">{app}/api/webhooks/elevenlabs</code><p className="mt-1 text-xs text-slate-500">Optional: calls are also pulled from ElevenLabs automatically, so they log even without the webhook.</p></div>
          </div> : null}
        </div>

        <div className="space-y-6 lg:col-span-3">
          {followup ? <div className="card"><h2 className="mb-3">Website leads</h2><LeadList leads={leads} showNotes /></div> : null}
          {customerCare ? <OpenQuestions r={r} questions={openQs} returnTo={returnTo} /> : null}
          <KnowledgeBaseEditor receptionistId={r.id} items={r.knowledge} returnTo={returnTo} />
          <KbHistory receptionistId={r.id} revisions={await kbHistory(r.id)} returnTo={returnTo} teamName="Team" />
          {customerCare ? <BookingsList r={r} bookings={recentBookings} returnTo={returnTo} timezone={r.timezone} /> : null}
          <CallList receptionistId={r.id} calls={r.calls} returnTo={returnTo} canBlock />
        </div>
      </div>
    </div>
  );
}
