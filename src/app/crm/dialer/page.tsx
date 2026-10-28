import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { memberLabel, teamMembers } from "@/lib/team";
import { PROSPECT_STAGES, STAGE_LABELS, type Stage } from "@/lib/constants";
import { dialerStatus } from "@/lib/dialer";
import { Notice, PageHeader } from "@/components/ui";
import { Dialer, type DialTarget, type DialerControls } from "@/components/Dialer";
import { VoicemailRecorder } from "@/components/VoicemailRecorder";
import { SubmitButton } from "@/components/SubmitButton";
import { Flash } from "@/components/Flash";
import { audioUrl, DEFAULT_VM_PROMPT, voicemailSettings } from "@/lib/voicemail";
import { deleteVoicemail, saveVoicemailSettings, setDefaultVoicemail, uploadVoicemail } from "../actions";
import { dialAccountInclude, toDialTarget } from "@/lib/dial-targets";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // pre-writing + voicing AI voicemails

const SORTS: Record<string, { label: string; orderBy: Prisma.AccountOrderByWithRelationInput[] }> = {
  best: { label: "Best to call now (tasks due, replies, opens…)", orderBy: [{ lastContactedAt: { sort: "asc", nulls: "first" } }] },
  stale: { label: "Last touched: longest ago first", orderBy: [{ lastContactedAt: { sort: "asc", nulls: "first" } }, { fitScore: { sort: "desc", nulls: "last" } }] },
  recent: { label: "Last touched: most recent first", orderBy: [{ lastContactedAt: { sort: "desc", nulls: "last" } }] },
  fit: { label: "Research fit score: highest first", orderBy: [{ fitScore: { sort: "desc", nulls: "last" } }, { lastContactedAt: { sort: "asc", nulls: "first" } }] },
  followup: { label: "Follow-up due: soonest first", orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }] },
  missed: { label: "Est. missed calls: highest first", orderBy: [{ estMissedCallsPerWeek: { sort: "desc", nulls: "last" } }] },
  newest: { label: "Newest accounts first", orderBy: [{ createdAt: "desc" }] },
};


export default async function DialerPage({ searchParams }: { searchParams: Promise<{ sort?: string; stage?: string; due?: string; q?: string; vm?: string; owner?: string; notice?: string; error?: string }> }) {
  const sp = await searchParams;
  const session = await requireStaff();
  const isAdmin = session.role === "ADMIN";
  // Reps call their own accounts and unassigned ones (which become theirs on the first call).
  // Admins default to the same view and can switch to everyone's or one rep's list.
  const ownerFilter = isAdmin ? sp.owner ?? "mine" : "mine";
  const ownerWhere: Prisma.AccountWhereInput =
    ownerFilter === "all" ? {} : ownerFilter === "mine" ? { OR: [{ ownerId: session.sub }, { ownerId: null }] } : ownerFilter === "unassigned" ? { ownerId: null } : { ownerId: ownerFilter };
  const sort = SORTS[sp.sort ?? ""] ? sp.sort! : "best";
  const stages = sp.stage && (PROSPECT_STAGES as string[]).includes(sp.stage) ? [sp.stage as Stage] : PROSPECT_STAGES;
  const where: Prisma.AccountWhereInput = {
    stage: { in: stages },
    AND: [ownerWhere, { OR: [{ phone: { not: null } }, { contacts: { some: { phone: { not: null } } } }] }],
    ...(sp.due === "1" ? { nextFollowUpAt: { lte: new Date() } } : {}),
    ...(sp.q ? { name: { contains: sp.q, mode: "insensitive" as const } } : {}),
  };
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [status, accounts, today, vmSettings, voicemails, voices, team] = await Promise.all([
    dialerStatus(),
    db.account.findMany({ where, orderBy: SORTS[sort]!.orderBy, take: 200, include: dialAccountInclude }),
    db.activity.groupBy({ by: ["outcome"], where: { source: "dialer", type: "CALL", occurredAt: { gte: startOfDay }, createdById: session.sub }, _count: true }),
    voicemailSettings(),
    db.voicemailAudio.findMany({ where: { kind: { in: ["recorded", "upload"] } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, durationSec: true, createdAt: true } }),
    db.receptionist.findMany({ where: { voiceId: { not: null } }, select: { name: true, voiceId: true } }),
    isAdmin ? teamMembers() : Promise.resolve([]),
  ]);
  const controls: DialerControls = {
    voicemails: voicemails.map((v) => ({ id: v.id, name: v.name })),
    defaultVoicemailId: vmSettings.defaultId && voicemails.some((v) => v.id === vmSettings.defaultId) ? vmSettings.defaultId : (voicemails[0]?.id ?? null),
    aiVoice: Boolean(vmSettings.voiceId),
    consent: vmSettings.consent,
  };

  const rows = accounts.map((a) => toDialTarget(a)).filter((t) => t.numbers.length);
  if (sort === "best") rows.sort((x, y) => y.priority - x.priority);
  const targets: DialTarget[] = rows;
  const calls = today.reduce((n, t) => n + t._count, 0);
  const connects = today.filter((t) => ["connected", "booked", "call_back", "not_interested"].includes(t.outcome ?? "")).reduce((n, t) => n + t._count, 0);
  const booked = today.find((t) => t.outcome === "booked")?._count ?? 0;

  return (
    <div>
      <PageHeader title="Power dialer" subtitle={`${targets.length} active prospects with a phone number · you today: ${calls} calls, ${connects} conversations, ${booked} booked`} />
      {!status.ready ? (
        <Notice kind="error">The dialer isn&apos;t set up yet. Go to <Link href="/crm/settings">Settings → Dialer</Link> and click <b>Set up dialer</b>.</Notice>
      ) : null}
      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="space-y-1"><span className="label">Sort</span>
          <select name="sort" defaultValue={sort} className="input">{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </label>
        <label className="space-y-1"><span className="label">Stage</span>
          <select name="stage" defaultValue={sp.stage ?? ""} className="input"><option value="">All active</option>{PROSPECT_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select>
        </label>
        {isAdmin ? (
          <label className="space-y-1"><span className="label">Accounts</span>
            <select name="owner" defaultValue={ownerFilter} className="input">
              <option value="mine">Mine + unassigned</option>
              <option value="unassigned">Unassigned only</option>
              <option value="all">Everyone&apos;s</option>
              {team.filter((u) => u.id !== session.sub).map((u) => <option key={u.id} value={u.id}>{memberLabel(u)}&apos;s</option>)}
            </select>
          </label>
        ) : null}
        <label className="space-y-1"><span className="label">Search</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Business name" className="input" /></label>
        <label className="flex items-center gap-1 pb-2"><input type="checkbox" name="due" value="1" defaultChecked={sp.due === "1"} /> Follow-up due only</label>
        <button className="btn-secondary">Apply</button>
      </form>
      <Flash params={sp} />
      <Dialer targets={targets} title="Call list" emptyText="No active prospects with a phone number match these filters." controls={controls} />

      {isAdmin ? <details id="voicemail" className="card mt-6" open={sp.vm === "1"}>
        <summary className="cursor-pointer font-semibold">Voicemail settings</summary>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="font-medium">Your recorded voicemails</h3>
            <VoicemailRecorder />
            <form action={uploadVoicemail} className="flex flex-wrap items-center gap-2 text-sm">
              <input name="name" placeholder="Name (optional)" className="input w-40" />
              <input name="file" type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" className="text-xs" required />
              <SubmitButton className="btn-secondary" pendingText="Uploading…">Upload MP3/WAV</SubmitButton>
            </form>
            {voicemails.length ? (
              <ul className="space-y-2 text-sm">
                {voicemails.map((v) => (
                  <li key={v.id} className="rounded-lg border border-slate-200 p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{v.name}{controls.defaultVoicemailId === v.id ? <span className="ml-2 text-xs text-emerald-700">default</span> : null}</span>
                      <span className="flex gap-3 text-xs">
                        {controls.defaultVoicemailId !== v.id ? <form action={setDefaultVoicemail.bind(null, v.id)}><button className="underline">Make default</button></form> : null}
                        <form action={deleteVoicemail.bind(null, v.id)}><button className="text-red-600">Delete</button></form>
                      </span>
                    </div>
                    <audio controls preload="none" src={audioUrl(v.id)} className="mt-1 h-8 w-full" />
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-slate-500">No recorded voicemail yet. Record one with your headset, or upload an MP3/WAV.</p>}
          </div>

          <form action={saveVoicemailSettings} className="space-y-3">
            <h3 className="font-medium">AI voicemail</h3>
            <p className="text-xs text-slate-500">While the phone rings, the AI writes a short voicemail from this prompt and the account&apos;s research, and ElevenLabs voices it, so it&apos;s ready at the beep. It&apos;s reused for that account for 3 days. Variables: <code>{"{{contacts}}"}</code>, <code>{"{{company}}"}</code>, <code>{"{{industry}}"}</code>, <code>{"{{location}}"}</code>, <code>{"{{my_company}}"}</code>, <code>{"{{callback_number}}"}</code>.</p>
            <textarea name="prompt" rows={7} defaultValue={vmSettings.prompt} placeholder={DEFAULT_VM_PROMPT} className="input text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-sm"><span className="label">ElevenLabs voice ID</span>
                <input name="voiceId" defaultValue={vmSettings.voiceId ?? ""} list="vm-voices" placeholder="voice id" className="input font-mono text-xs" />
                <datalist id="vm-voices">{voices.map((v) => <option key={v.voiceId} value={v.voiceId!}>{v.name}</option>)}</datalist>
              </label>
              <label className="space-y-1 text-sm"><span className="label">Callback number to say</span>
                <input name="callback" defaultValue={vmSettings.callback} className="input" />
              </label>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <b>Before using pre-recorded or AI voicemails:</b> in Canada, the CRTC&apos;s rules on automatic dialing-announcing devices restrict pre-recorded solicitation messages without consent, and in the US the FCC treats pre-recorded and AI-voiced voicemails as robocalls that need prior consent. Leaving your own voicemail live avoids this. This isn&apos;t legal advice; check before using these at scale, especially on cell phones.
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" name="consent" defaultChecked={vmSettings.consent} /> I understand, and will only use recorded/AI voicemails where it&apos;s allowed</label>
            </div>
            <SubmitButton className="btn-secondary" pendingText="Saving…">Save voicemail settings</SubmitButton>
          </form>
        </div>
      </details> : null}
    </div>
  );
}
