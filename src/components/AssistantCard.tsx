import type { KnownCaller } from "@prisma/client";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { CATEGORIES, CATEGORY_LABELS, isCategory, parseRoutingRules, prettyPhone, ROUTE_ACTIONS, ROUTE_LABELS } from "@/lib/assistant-rules";
import { labelPendingCaller, removeKnownCaller, removeOwnerPin, saveDigestSetting, saveKnownCaller, saveOwnerPin, saveRoutingRules, setAssistantOverride } from "@/app/assistant-actions";

type Line = {
  id: string;
  name: string;
  businessNumber: string | null;
  ringFirstNumber: string | null;
  escalationPhone: string | null;
  ownerPinHash: string | null;
  ownerPinLockedUntil: Date | null;
  routingRules: string;
  labelDigestOn: boolean;
  assistantOverride: string;
};

const OVERRIDE: Record<string, string> = { "": "Follow the account's plan", on: "On (comped or manual billing)", off: "Off" };

/**
 * The Assistant tier for one line: who's in its caller directory (and who's waiting to be
 * labelled), how each kind of caller is routed, the owner's PIN and the evening text. In the
 * portal it's only shown on lines that have the tier; the team always sees it, with the switch.
 */
export function AssistantCard({ r, entitled, callers, returnTo, staff }: { r: Line; entitled: boolean; callers: KnownCaller[]; returnTo: string; staff: boolean }) {
  const rules = parseRoutingRules(r.routingRules);
  const pending = callers.filter((c) => c.status === "PENDING");
  const known = callers.filter((c) => c.status === "LABELLED");
  const owner = r.ringFirstNumber || r.escalationPhone;
  const locked = r.ownerPinLockedUntil && r.ownerPinLockedUntil.getTime() > Date.now();

  return (
    <div className="card space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <h2>Assistant</h2>
        {entitled ? <Badge className="bg-emerald-100 text-emerald-800">on</Badge> : <Badge>not on this plan</Badge>}
      </div>

      {staff ? (
        <form action={setAssistantOverride.bind(null, r.id, returnTo)} className="flex flex-wrap items-end gap-2">
          <label className="flex-1">
            <span className="label">Assistant tier for this line</span>
            <select name="assistantOverride" defaultValue={r.assistantOverride} className="input">
              {Object.entries(OVERRIDE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button className="btn-secondary">Save</button>
        </form>
      ) : null}

      {!entitled ? (
        <p className="text-xs text-slate-500">Owner updates by phone and text, caller routing, the evening caller list and check-in calls come with the Assistant Plan. Put the account on it (CRM → account → billing), or switch it on above. Demos and your own line always have it.</p>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            {r.name} learns who&apos;s who. Callers who aren&apos;t customers (suppliers, sales reps, sub-trades, staff, family) are listed in one text each evening; reply like &ldquo;1S 2V&rdquo; and they&apos;re handled your way from then on. You can also sort them here.
          </p>

          {pending.length ? (
            <div className="space-y-2">
              <div className="label">Waiting for you ({pending.length})</div>
              <ul className="divide-y divide-slate-100">
                {pending.map((c) => (
                  <li key={c.id} className="space-y-1 py-2">
                    <div><b>{[c.name, c.company].filter(Boolean).join(", ") || "Unknown caller"}</b> <span className="text-slate-500">{prettyPhone(c.phone)}{c.lastCallAt ? ` · ${formatDate(c.lastCallAt, true)}` : ""}</span></div>
                    {c.note ? <div className="text-xs text-slate-600">{c.note}</div> : null}
                    <form action={labelPendingCaller.bind(null, r.id, c.id, returnTo)} className="flex flex-wrap gap-2">
                      <select name="category" defaultValue={isCategory(c.suggested) ? c.suggested : ""} className="input w-48" aria-label="What they are">
                        <option value="" disabled>What are they?</option>
                        {CATEGORIES.map((k) => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
                        <option value="DISMISS">Don&apos;t know: skip</option>
                      </select>
                      <button className="btn-secondary py-1 text-xs">Save</button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="label">Known callers</div>
            {known.length ? (
              <ul className="divide-y divide-slate-100">
                {known.map((c) => (
                  <li key={c.id} className="py-1.5">
                    <details>
                      <summary className="flex cursor-pointer items-center justify-between gap-2">
                        <span><b>{[c.name, c.company].filter(Boolean).join(", ") || prettyPhone(c.phone)}</b> <span className="text-slate-500">{prettyPhone(c.phone)}</span></span>
                        <span className="text-xs text-slate-500">{isCategory(c.category) ? CATEGORY_LABELS[c.category] : ""}{c.routeAction ? ` · ${ROUTE_LABELS[c.routeAction as keyof typeof ROUTE_LABELS] ?? ""}` : ""}</span>
                      </summary>
                      <CallerForm lineId={r.id} returnTo={returnTo} caller={c} />
                      <form action={removeKnownCaller.bind(null, r.id, c.id, returnTo)} className="mt-1"><button className="text-xs text-red-600 underline">Remove</button></form>
                    </details>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-slate-500">Nobody yet.</p>}
            <details>
              <summary className="cursor-pointer text-xs underline">Add a caller</summary>
              <CallerForm lineId={r.id} returnTo={returnTo} />
            </details>
          </div>

          <form action={saveRoutingRules.bind(null, r.id, returnTo)} className="space-y-2">
            <div className="label">How each kind of caller is handled</div>
            <p className="text-xs text-slate-500">&ldquo;Put them through&rdquo; rings {owner ? <b>{prettyPhone(owner)}</b> : "your cell (set a ring-first or transfer number first)"} with a press-1 screen, unless you enter another number. Nobody answers: {r.name} takes a message.</p>
            {CATEGORIES.filter((c) => c !== "CUSTOMER").map((c) => (
              <div key={c} className="flex flex-wrap items-center gap-2">
                <span className="w-40 text-xs">{CATEGORY_LABELS[c]}</span>
                <select name={`action_${c}`} defaultValue={rules[c].action} className="input w-44" aria-label={`${CATEGORY_LABELS[c]}: what to do`}>
                  {ROUTE_ACTIONS.map((a) => <option key={a} value={a}>{ROUTE_LABELS[a]}</option>)}
                </select>
                <input name={`to_${c}`} type="tel" defaultValue={rules[c].to ?? ""} placeholder="Number (blank = you)" className="input w-40" aria-label={`${CATEGORY_LABELS[c]}: number to put them through to`} />
              </div>
            ))}
            <button className="btn-secondary">Save routing</button>
          </form>

          <div className="space-y-2">
            <div className="label">Owner PIN {r.ownerPinHash ? <Badge className="ml-1 bg-emerald-100 text-emerald-800">set</Badge> : <Badge className="ml-1">not set</Badge>} {locked ? <Badge className="ml-1 bg-red-100 text-red-800">locked for now</Badge> : null}</div>
            <p className="text-xs text-slate-500">Bigger changes by phone or text (regular hours, prices, services, policies, routing) need this PIN, keyed in on the phone keypad or texted back. Without one, they&apos;re confirmed by replying YES to a text. 4 to 8 digits; 3 wrong tries lock it for 15 minutes.</p>
            <form action={saveOwnerPin.bind(null, r.id, returnTo)} className="flex flex-wrap gap-2">
              <input name="pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4,8}" required placeholder={r.ownerPinHash ? "New PIN" : "PIN"} className="input w-32" aria-label="PIN" />
              <input name="pin2" type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4,8}" required placeholder="Again" className="input w-32" aria-label="PIN again" />
              <button className="btn-secondary">{r.ownerPinHash ? "Change PIN" : "Set PIN"}</button>
            </form>
            {r.ownerPinHash ? <form action={removeOwnerPin.bind(null, r.id, returnTo)}><button className="text-xs text-red-600 underline">Remove PIN</button></form> : null}
          </div>

          <form action={saveDigestSetting.bind(null, r.id, returnTo)} className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2"><input type="checkbox" name="labelDigestOn" defaultChecked={r.labelDigestOn} /> Evening text listing new callers to sort{r.businessNumber ? "" : " (needs a business line)"}</label>
            <button className="btn-secondary py-1 text-xs">Save</button>
          </form>
        </>
      )}
    </div>
  );
}

function CallerForm({ lineId, returnTo, caller }: { lineId: string; returnTo: string; caller?: KnownCaller }) {
  return (
    <form action={saveKnownCaller.bind(null, lineId, returnTo)} className="mt-2 grid grid-cols-2 gap-2">
      {caller ? <input type="hidden" name="id" value={caller.id} /> : null}
      <input name="name" defaultValue={caller?.name ?? ""} placeholder="Name" className="input" aria-label="Name" />
      <input name="company" defaultValue={caller?.company ?? ""} placeholder="Company" className="input" aria-label="Company" />
      <input name="phone" type="tel" required defaultValue={caller?.phone ?? ""} placeholder="Number" className="input" aria-label="Number" />
      <select name="category" required defaultValue={caller?.category ?? ""} className="input" aria-label="What they are">
        <option value="" disabled>What are they?</option>
        {CATEGORIES.map((k) => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
      </select>
      <select name="routeAction" defaultValue={caller?.routeAction ?? ""} className="input" aria-label="How to handle them">
        <option value="">Same as their kind</option>
        {ROUTE_ACTIONS.map((a) => <option key={a} value={a}>{ROUTE_LABELS[a]}</option>)}
      </select>
      <input name="routeTo" type="tel" defaultValue={caller?.routeTo ?? ""} placeholder="Put through to (blank = you)" className="input" aria-label="Put through to" />
      <div className="col-span-2"><button className="btn-secondary py-1 text-xs">{caller ? "Save" : "Add"}</button></div>
    </form>
  );
}
