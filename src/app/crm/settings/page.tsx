import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { AiModels } from "./AiModels";
import { dialerStatus } from "@/lib/dialer";
import { setupDialerAction } from "../actions";
import { formatPhone } from "@/lib/demo-line";
import { elevenLabsConfigured } from "@/lib/elevenlabs";
import { googleConfigured, googleConnection } from "@/lib/google";
import { stripeConfigured } from "@/lib/billing";
import { getSetting } from "@/lib/settings";
import { DEFAULT_CLIENT_GOAL } from "@/lib/constants";
import { formatDate, safeJson } from "@/lib/utils";
import { Badge, Field, PageHeader } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { companyName } from "@/lib/brand";
import { changePassword, disconnectGoogle, saveCompanyName, saveGoal, seedDefaultPrompts } from "../actions";

export const dynamic = "force-dynamic";

function Status({ ok, label }: { ok: boolean; label?: string }) {
  return ok ? <Badge className="bg-emerald-100 text-emerald-800">{label ?? "configured"}</Badge> : <Badge className="bg-red-100 text-red-800">not configured</Badge>;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const session = await requireStaff();
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
        {passwordCard}
      </div>
    );
  }
  const company = await companyName();
  const dialer = await dialerStatus();
  const [google, lastSync, goalRaw, promptCount, driveRoot] = await Promise.all([
    googleConnection(),
    getSetting("gmail.lastSyncAt"),
    getSetting("goal.clients"),
    db.savedPrompt.count(),
    getSetting("drive.root"),
  ]);
  const goal = safeJson<{ min: number; max: number; targetDate?: string }>(goalRaw, DEFAULT_CLIENT_GOAL);
  const app = (process.env.APP_URL ?? "").replace(/\/$/, "");

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

      {passwordCard}

      <div className="card">
        <h2 className="mb-3">Growth goal</h2>
        <form action={saveGoal} className="grid grid-cols-3 gap-3">
          <Field label="Minimum paying clients"><input name="min" type="number" defaultValue={goal.min} className="input" /></Field>
          <Field label="Stretch goal"><input name="max" type="number" defaultValue={goal.max} className="input" /></Field>
          <Field label="Target date"><input name="targetDate" type="date" defaultValue={goal.targetDate} className="input" /></Field>
          <div className="col-span-3"><button className="btn-secondary">Save goal</button></div>
        </form>
      </div>

      <div className="card space-y-4 text-sm">
        <h2>Integrations</h2>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">Google Drive + Gmail + Calendar</div>
            <div className="text-xs text-slate-500">Folder system for every account, research docs, outreach logs, automatic Gmail outreach tracking + tracked sending, and Calendar availability + booking for receptionists.</div>
            {google.connected ? <div className="mt-1 text-xs">Connected as <b>{google.email}</b>{lastSync ? ` · last Gmail sync ${formatDate(lastSync, true)}` : ""}{driveRoot ? <> · <a href={`https://drive.google.com/drive/folders/${driveRoot}`} target="_blank" rel="noreferrer">open Drive root</a></> : null}</div> : null}
            {google.connected && !google.calendar ? <div className="mt-1 text-xs text-amber-700">Connected before Calendar access was added — click Connect Google again to grant it.</div> : null}
          </div>
          <div className="shrink-0">
            {!googleConfigured() ? <Status ok={false} /> : google.connected ? (
              <form action={disconnectGoogle}><button className="btn-secondary">Disconnect</button></form>
            ) : <a href="/api/google/auth" className="btn">Connect Google</a>}
          </div>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div><div className="font-medium">AI (Claude / Gemini)</div><div className="text-xs text-slate-500">Prospecting, account research, KB drafting, outreach drafting, caller summaries and receptionist test chats. Choose models per job under AI models below.</div></div>
          <Status ok={aiConfigured()} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div><div className="font-medium">ElevenLabs</div><div className="text-xs text-slate-500">Agent + knowledge-base sync. Post-call webhook: <code>{app}/api/webhooks/elevenlabs</code></div></div>
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

      <div className="card text-sm">
        <h2 className="mb-2">Starter prompts</h2>
        <p className="mb-3 text-slate-600">{promptCount} saved prompts. Add the built-in research, prospecting and outreach prompts (skips any you already have).</p>
        <form action={seedDefaultPrompts}><button className="btn-secondary">Add starter prompts</button></form>
      </div>
    </div>
  );
}
