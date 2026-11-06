import { appUrl, appUrlNeedsFixing } from "@/lib/app-url";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { AiModels } from "./AiModels";
import { dialerStatus } from "@/lib/dialer";
import { setupDialerAction } from "../actions";
import { formatPhone } from "@/lib/demo-line";
import { elevenLabsConfigured } from "@/lib/elevenlabs";
import { googleConfigured, googleConnection, isConsumerGoogle } from "@/lib/google";
import { stripeConfigured } from "@/lib/billing";
import { getSetting } from "@/lib/settings";
import { timezoneDataCurrent } from "@/lib/booking";
import QRCode from "qrcode";
import { open } from "@/lib/secret-box";
import { otpauthUrl } from "@/lib/totp";
import { TwoStepCard } from "@/components/TwoStepCard";
import { DEFAULT_CLIENT_GOAL } from "@/lib/constants";
import { formatDate, safeJson } from "@/lib/utils";
import { Badge, Field, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { companyName } from "@/lib/brand";
import { blockNumberManually, saveCuratedVoicesAction, saveSpendAlert, unblockNumber } from "../actions";
import { spendAlertAmount } from "@/lib/call-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { curatedVoices, MAX_CURATED_VOICES } from "@/lib/voices";
import { changePassword, disconnectGoogle, disconnectMyGoogle, migrateElevenLabsAgents, makeSampleCalls, rebuildDriveFolders, saveCompanyName, saveGoal, saveSendAs, seedDefaultPrompts } from "../actions";

export const dynamic = "force-dynamic";

function Status({ ok, label }: { ok: boolean; label?: string }) {
  return ok ? <Badge className="bg-emerald-100 text-emerald-800">{label ?? "configured"}</Badge> : <Badge className="bg-red-100 text-red-800">not configured</Badge>;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const voiceList = await curatedVoices();
  const session = await requireStaff();
  const [me, myRow] = await Promise.all([googleConnection(session.sub), db.googleAccount.findUnique({ where: { userId: session.sub }, select: { lastSyncAt: true, lastError: true } })]);
  const myGoogleCard = (
    <div className="card space-y-2 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2>Your Gmail &amp; Calendar</h2>
          <p className="text-xs text-slate-500">Emails you send from the CRM go from your own Gmail with open and click tracking, your replies are logged on the account, and your demo receptionists book meetings straight into your calendar.</p>
          {me.connected ? (
            <p className="mt-1 text-xs">Connected as <b>{me.email}</b>{me.personal ? "" : " (the company Google account, which is yours)"}{myRow?.lastSyncAt ? ` · Gmail synced ${formatDate(myRow.lastSyncAt, true)}` : ""}</p>
          ) : null}
          {myRow?.lastError ? <p className="mt-1 text-xs text-red-700">{myRow.lastError} Click Reconnect.</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {!googleConfigured() ? <Status ok={false} /> : (
            <>
              <a href="/api/google/auth?for=me" className={me.connected ? "btn-secondary" : "btn"}>{me.connected ? (me.personal ? "Reconnect" : "Use a different account") : "Connect Gmail & Calendar"}</a>
              {me.personal ? <form action={disconnectMyGoogle}><button className="btn-secondary">Disconnect</button></form> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
  const meUser = await db.user.findUniqueOrThrow({ where: { id: session.sub }, select: { email: true, totpSecret: true, totpEnabledAt: true, recoveryCodes: true } });
  const pendingSecret = !meUser.totpEnabledAt && meUser.totpSecret ? open(meUser.totpSecret) : null;
  const twoStepCard = (
    <TwoStepCard
      enabledAt={meUser.totpEnabledAt?.toISOString() ?? null}
      setup={pendingSecret ? { secret: pendingSecret, qr: await QRCode.toDataURL(otpauthUrl(pendingSecret, meUser.email, "Head Above Digital"), { margin: 1, width: 180 }) } : null}
      recoveryLeft={safeJson<string[]>(meUser.recoveryCodes, []).length}
    />
  );
  const passwordCard = (
        <div className="card">
          <h2 className="mb-3">Your password</h2>
          <form action={changePassword} className="grid grid-cols-3 gap-3">
            <Field label="Current password"><input name="current" type="password" autoComplete="current-password" className="input" required /></Field>
            <Field label="New password (10+ characters)"><input name="next" type="password" autoComplete="new-password" minLength={10} className="input" required /></Field>
            <Field label="Confirm new password"><input name="confirm" type="password" autoComplete="new-password" minLength={10} className="input" required /></Field>
            <div className="col-span-3"><button className="btn-secondary">Change password</button></div>
          </form>
        </div>
  );
  if (session.role !== "ADMIN") {
    // Reps: their own password. Everything else here is for administrators.
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader title="Settings" subtitle={`Signed in as ${session.email}`} />
        <Flash params={await searchParams} />
        {myGoogleCard}
        {passwordCard}
        {twoStepCard}
      </div>
    );
  }
  const company = await companyName();
  const dialer = await dialerStatus();
  const [blocked, spendAlert] = await Promise.all([db.blockedNumber.findMany({ orderBy: { createdAt: "desc" }, take: 50 }), spendAlertAmount().catch(() => null)]);
  const [previousGoogle, sendAs, migrationRaw] = await Promise.all([getSetting("google.previousEmail"), getSetting("google.sendAs"), getSetting("elevenlabs.migration")]);
  const [sampleRows, sampleRunRaw] = await Promise.all([db.sampleAudio.findMany({ select: { key: true, createdAt: true } }), getSetting("samples.lastRun")]);
  const sampleRun = safeJson<{ at: string; results: { key: string; ok: boolean; note: string }[] } | null>(sampleRunRaw, null);
  const migration = safeJson<import("@/lib/elevenlabs-migrate").MigrationReport | null>(migrationRaw, null);
  const [google, lastSync, goalRaw, promptCount, driveRoot] = await Promise.all([
    googleConnection(),
    getSetting("gmail.lastSyncAt"),
    getSetting("goal.clients"),
    db.savedPrompt.count(),
    getSetting("drive.root"),
  ]);
  const goal = safeJson<{ min: number; max: number; targetDate?: string }>(goalRaw, DEFAULT_CLIENT_GOAL);
  const app = appUrl();

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" />
      <Flash params={await searchParams} />

      <div className="card flex items-center justify-between gap-3">
        <div>
          <h2>Team &amp; users</h2>
          <p className="text-xs text-slate-500">Add sales reps and administrators, reset passwords, turn off access.</p>
        </div>
        <Link href="/crm/settings/users" className="btn-secondary">Manage users</Link>
      </div>

      <div className="card">
        <h2 className="mb-3">Company</h2>
        <form action={saveCompanyName} className="grid grid-cols-3 items-end gap-3">
          <Field label="Company name" className="col-span-2"><input name="companyName" defaultValue={company} className="input" required /></Field>
          <div><button className="btn-secondary">Save</button></div>
          <label className="col-span-3 flex items-center gap-2 text-sm"><input type="checkbox" name="rewrite" defaultChecked /> Also replace the old name in saved prompts, the demo line greeting, and your own account, receptionist and knowledge base</label>
          <p className="col-span-3 text-xs text-slate-500">Used across the CRM, client portal, Claude research and outreach (<code>{"{{my_company}}"}</code> in saved prompts) and the demo line.</p>
        </form>
      </div>

      <AiModels />

      <div className="card space-y-2">
        <h2>Dialer</h2>
        <p className="text-xs text-slate-500">Call prospects from the browser (headset or earbuds) on the account page and the Dialer page. Calls show caller ID {dialer.callerId ? <b>{formatPhone(dialer.callerId)}</b> : "(set TWILIO_DEMO_NUMBER)"}, are recorded, and{dialer.notes ? " Gemini adds a transcript, summary and next step to the account." : " (add GEMINI_API_KEY for automatic call summaries)."} Twilio bills about US$0.02 per minute plus recording.</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge className={dialer.ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>{dialer.ready ? "ready" : dialer.twilio ? "not set up" : "needs Twilio keys"}</Badge>
          {dialer.twilio ? <form action={setupDialerAction}><button className="btn-secondary">{dialer.ready ? "Re-run setup" : "Set up dialer"}</button></form> : null}
        </div>
        <p className="text-xs text-slate-500">Setup creates a &ldquo;CRM dialer&rdquo; TwiML App and API key on your Twilio account. The Twilio account must be upgraded (trial accounts can only call verified numbers).</p>
      </div>

      {myGoogleCard}

      {passwordCard}
      {twoStepCard}

      <div className="card">
        <h2 className="mb-3">Growth goal</h2>
        <form action={saveGoal} className="grid grid-cols-3 gap-3">
          <Field label="Minimum paying clients"><input name="min" type="number" defaultValue={goal.min} className="input" /></Field>
          <Field label="Stretch goal"><input name="max" type="number" defaultValue={goal.max} className="input" /></Field>
          <Field label="Target date"><input name="targetDate" type="date" defaultValue={goal.targetDate} className="input" /></Field>
          <div className="col-span-3"><button className="btn-secondary">Save goal</button></div>
        </form>
      </div>

      {appUrlNeedsFixing() ? <div className="card border-amber-300 bg-amber-50 text-sm text-amber-900">The <code>APP_URL</code> setting in Vercel has extra characters (a comma, space or second address). The app is using <b>{app}</b>. Set <code>APP_URL</code> to exactly that, with no comma or trailing slash, and redeploy.</div> : null}
      <div className="card space-y-4 text-sm">
        <h2>Integrations</h2>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">Company Google (Drive + client receptionists)</div>
            <div className="text-xs text-slate-500">The company Google account: the Drive folder system for every account, research docs and outreach logs, and Calendar availability + booking (and email confirmations) for client receptionists. Each person connects their own Gmail above.</div>
            {google.connected ? <div className="mt-1 text-xs">Connected as <b>{google.email}</b>{lastSync ? ` · last Gmail sync ${formatDate(lastSync, true)}` : ""}{driveRoot ? <> · <a href={`https://drive.google.com/drive/folders/${driveRoot}`} target="_blank" rel="noreferrer">open Drive root</a></> : null}</div> : null}
            {google.connected && !google.calendar ? <div className="mt-1 text-xs text-amber-700">Connected before Calendar access was added — click Connect Google again to grant it.</div> : null}
            {google.connected && isConsumerGoogle(google.email) ? <div className="mt-1 text-xs text-amber-700">This is a personal Gmail account. Disconnect it and connect the business Workspace account{process.env.GOOGLE_WORKSPACE_DOMAIN ? ` (@${process.env.GOOGLE_WORKSPACE_DOMAIN})` : ""}, then rebuild the Drive folders below.</div> : null}
            {google.connected && previousGoogle ? (
              <form action={rebuildDriveFolders} className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                Switched from {previousGoogle}. The Drive folders and documents are still in that account: rebuild them in {google.email} (they&apos;re recreated from the CRM). Files you added by hand stay in the old Drive; share that folder with {google.email} and move them across.
                <div className="mt-1"><button className="btn-secondary py-1 text-xs">Rebuild Drive folders here</button></div>
              </form>
            ) : null}
            {google.connected ? (
              <form action={saveSendAs} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">Support, admin and billing address (client reports, caller follow-ups, change requests, minute alerts; shown in the client portal). Sales emails go from each person&apos;s own Gmail.</span>
                <input name="sendAs" type="email" defaultValue={sendAs ?? ""} placeholder={google.email ?? ""} className="input w-56 py-1 text-xs" />
                <button className="btn-secondary py-1 text-xs">Save</button>
              </form>
            ) : null}
          </div>
          <div className="shrink-0">
            {!googleConfigured() ? <Status ok={false} /> : google.connected ? (
              <form action={disconnectGoogle}><button className="btn-secondary">Disconnect</button></form>
            ) : <a href="/api/google/auth" className="btn">Connect Google</a>}
          </div>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">Website sample calls</div>
            <div className="text-xs text-slate-500">The six recorded calls in the website&apos;s call player ({sampleRows.length} of 6 recorded). Recorded once with ElevenLabs and stored; visitors only play them, so there&apos;s no ongoing cost. Re-record after changing a script or voice.</div>
            {sampleRun ? (
              <ul className="mt-1 list-disc pl-4 text-xs">
                {sampleRun.results.map((r) => <li key={r.key} className={r.ok ? "text-slate-600" : "text-red-700"}>{r.key.replace(":", " · ")}: {r.note}</li>)}
              </ul>
            ) : null}
            <form action={makeSampleCalls} className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <button className="btn-secondary py-1 text-xs">{sampleRows.length >= 6 ? "Check sample calls" : "Make website sample calls"}</button>
              <label className="flex items-center gap-1 text-slate-500"><input type="checkbox" name="force" /> Re-record all</label>
            </form>
          </div>
          <Status ok={sampleRows.length >= 6} label="recorded" />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div><div className="font-medium">Time zone data</div><div className="text-xs text-slate-500">{timezoneDataCurrent() ? "Up to date: knows BC's 2026 move to permanent UTC-7, so bookings, calling hours and reports use the right times." : "Out of date: this server still thinks BC changes its clocks, so times after November 1 can be an hour off. In Vercel, set Settings → Build & Deployment → Node.js Version to the newest and redeploy."}</div></div>
          <Status ok={timezoneDataCurrent()} label="current" />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div><div className="font-medium">AI (Claude / Gemini)</div><div className="text-xs text-slate-500">Prospecting, account research, KB drafting, outreach drafting, caller summaries and receptionist test chats. Choose models per job under AI models below.</div></div>
          <Status ok={aiConfigured()} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">ElevenLabs</div>
            <div className="text-xs text-slate-500">Agent + knowledge-base sync. Post-call webhook: <code>{app}/api/webhooks/elevenlabs</code></div>
            {process.env.ELEVENLABS_LEGACY_API_KEY ? (
              <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs">
                <p>Moving to a new ElevenLabs account: re-creates every CRM agent in the account of <code>ELEVENLABS_API_KEY</code>, copying its voice and settings from the old account, then syncs it. Old call recordings keep playing through <code>ELEVENLABS_LEGACY_API_KEY</code>.</p>
                <form action={migrateElevenLabsAgents} className="mt-1"><button className="btn-secondary py-1 text-xs">Move agents to the new account</button></form>
                {migration ? (
                  <div className="mt-2 space-y-1">
                    <div className="text-slate-500">Last run {formatDate(migration.at, true)}:</div>
                    <ul className="list-disc pl-4">{migration.agents.map((a) => <li key={a.from}><b>{a.name}</b>: {a.note}</li>)}</ul>
                    {migration.voices.length ? <ul className="list-disc pl-4">{migration.voices.map((v) => <li key={v.voiceId} className={v.ok ? "" : "text-amber-800"}>Voice {v.note}</li>)}</ul> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <Status ok={elevenLabsConfigured()} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div><div className="font-medium">Twilio demo line</div><div className="text-xs text-slate-500">Voice webhook for {process.env.TWILIO_DEMO_NUMBER || "the demo number"}: <code>{app}/api/voice/demo</code>. Manage extensions on the <a href="/crm/demo-line">Demo line</a> page.</div></div>
          <Status ok={Boolean(process.env.TWILIO_AUTH_TOKEN)} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div><div className="font-medium">Stripe</div><div className="text-xs text-slate-500">Webhook: <code>{app}/api/webhooks/stripe</code> (checkout.session.completed, customer.subscription.*, invoice.*)</div></div>
          <Status ok={stripeConfigured()} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div><div className="font-medium">Outreach webhook</div><div className="text-xs text-slate-500">For Instantly / Lemlist / Smartlead / Zapier: <code>POST {app}/api/webhooks/outreach</code> with header <code>x-webhook-secret</code>.</div></div>
          <Status ok={Boolean(process.env.OUTREACH_WEBHOOK_SECRET)} />
        </div>
      </div>

      <div className="card mb-6 space-y-4 text-sm">
        <h2>Call protection</h2>
        <p className="text-xs text-slate-500">Each line&apos;s limits (call length, silence, per-caller and daily limits, calls at once) are on its receptionist page. Here: a Twilio spending alert and numbers blocked on every line.</p>
        <form action={saveSpendAlert} className="flex flex-wrap items-end gap-2">
          <Field label="Text and email me when a day's Twilio spend passes (US$, 0 = off)"><input name="amount" type="number" min={0} max={10000} defaultValue={spendAlert ?? 25} className="input w-32" /></Field>
          <SubmitButton className="btn-secondary">{spendAlert ? "Update alert" : "Turn on alert"}</SubmitButton>
          <span className="text-xs text-slate-500">{spendAlert ? `On: US$${spendAlert} a day.` : "Off."} Alerts go to administrators&apos; mobiles (CRM → Users) and the support email.</span>
        </form>
        <div>
          <div className="label">Blocked numbers</div>
          {blocked.length ? (
            <ul className="divide-y divide-slate-100">
              {blocked.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-1.5">
                  <span>{b.phone} <span className="text-xs text-slate-500">{b.reason}{b.createdBy ? ` · ${b.createdBy}` : ""} · {formatDate(b.createdAt)}</span></span>
                  <form action={unblockNumber.bind(null, b.id)}><button className="text-xs underline">Unblock</button></form>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-500">None. Block a caller from any call log, or add a number here.</p>}
          <form action={blockNumberManually} className="mt-2 flex flex-wrap gap-2">
            <input name="phone" placeholder="Number, or 'anonymous'" className="input w-48" aria-label="Number to block" />
            <input name="reason" placeholder="Reason (optional)" className="input w-56" aria-label="Reason" />
            <button className="btn-secondary">Block</button>
          </form>
        </div>
      </div>

      <form action={saveCuratedVoicesAction} className="card mb-6 space-y-3 text-sm">
        <h2>Voices clients can choose</h2>
        <p className="text-xs text-slate-500">Up to {MAX_CURATED_VOICES} ElevenLabs voices (copy the ID from the voice&apos;s menu in ElevenLabs; it must be in your account under My Voices). Clients pick one under Your setup; your team picks on each agent&apos;s page.</p>
        {Array.from({ length: MAX_CURATED_VOICES }, (_, i) => voiceList[i]).map((v, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input name={`voice_${i}`} defaultValue={v?.id ?? ""} placeholder="Voice ID" className="input w-64" />
            <input name={`label_${i}`} defaultValue={v?.label ?? ""} placeholder="Label clients see (e.g. Warm, female)" className="input w-64" />
            {v?.previewUrl ? <audio controls preload="none" src={v.previewUrl} className="h-8" /> : null}
          </div>
        ))}
        <button className="btn-secondary">Save voices</button>
      </form>

      <div className="card text-sm">
        <h2 className="mb-2">Starter prompts</h2>
        <p className="mb-3 text-slate-600">{promptCount} saved prompts. Add the built-in research, prospecting and outreach prompts (skips any you already have).</p>
        <form action={seedDefaultPrompts}><button className="btn-secondary">Add starter prompts</button></form>
      </div>
    </div>
  );
}
