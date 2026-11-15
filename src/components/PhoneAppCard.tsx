import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { PUSH_CATEGORIES, parsePrefs, type PushCategory } from "@/lib/push-rules";
import { removePasskey, removePushDevice, savePushPrefs, saveMyMobile } from "@/app/crm/settings/app-actions";
import { PushControls, TimezoneField } from "./PushControls";
import { PasskeyAdd } from "./PasskeyAdd";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => (h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`);

/** Settings → Phone & app: mobile number, notifications and passkeys for the signed-in user. */
export async function PhoneAppCard({ userId }: { userId: string }) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { phone: true, pushPrefs: true, pushSubscriptions: { orderBy: { createdAt: "desc" } }, passkeys: { orderBy: { createdAt: "desc" } } },
  });
  const prefs = parsePrefs(user.pushPrefs);
  const quiet = prefs.quietStart != null && prefs.quietEnd != null;
  return (
    <div id="phone-app" className="card space-y-5 text-sm">
      <div>
        <h2>Phone &amp; app</h2>
        <p className="text-xs text-slate-500">For the Head Above Android app (or Chrome on your phone).</p>
      </div>

      <section className="space-y-2">
        <h3 className="font-semibold">Your mobile</h3>
        <p className="text-xs text-slate-500">The dialer&apos;s &quot;Call my phone&quot; mode rings this number, then connects you to each prospect (they see the business number). It&apos;s also how Grace recognises you on our line, and where line alerts are texted.</p>
        <form action={saveMyMobile} className="flex flex-wrap gap-2">
          <input name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={user.phone ?? ""} placeholder="604 555 0100" className="input w-48" aria-label="Your mobile number" />
          <button className="btn-secondary">Save</button>
        </form>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Notifications</h3>
        <PushControls />
        {user.pushSubscriptions.length ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {user.pushSubscriptions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span>{s.device || "Device"} <span className="text-slate-500">· added {formatDate(s.createdAt)}{s.lastSuccessAt ? ` · last alert ${formatDate(s.lastSuccessAt, true)}` : ""}</span></span>
                <form action={removePushDevice.bind(null, s.id)}><button className="text-xs text-red-700">Remove</button></form>
              </li>
            ))}
          </ul>
        ) : null}
        <form action={savePushPrefs} className="space-y-3 rounded-lg bg-slate-50 p-3">
          <fieldset className="space-y-2">
            <legend className="label">Send me</legend>
            {(Object.keys(PUSH_CATEGORIES) as PushCategory[]).map((c) => (
              <label key={c} className="flex items-start gap-3">
                <input type="checkbox" name="on" value={c} defaultChecked={!prefs.off.includes(c)} className="mt-1 h-5 w-5" />
                <span>
                  <span className="font-medium">{PUSH_CATEGORIES[c].label}</span>
                  <span className="block text-xs text-slate-500">{PUSH_CATEGORIES[c].help}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <label className="flex items-center gap-3">
              <input type="checkbox" name="quiet" defaultChecked={quiet} className="h-5 w-5" />
              <span className="font-medium">Quiet hours</span>
            </label>
            <div className="flex flex-wrap items-center gap-2 pl-8 text-xs">
              from
              <select name="quietStart" defaultValue={prefs.quietStart ?? 21} className="input w-auto py-1 text-sm" aria-label="Quiet hours start">{HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
              to
              <select name="quietEnd" defaultValue={prefs.quietEnd ?? 7} className="input w-auto py-1 text-sm" aria-label="Quiet hours end">{HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
            </div>
            <label className="flex items-start gap-3 pl-8">
              <input type="checkbox" name="urgentInQuiet" defaultChecked={prefs.urgentInQuiet} className="mt-1 h-5 w-5" />
              <span className="text-xs">Line outages still come through in quiet hours (a client&apos;s calls going to voicemail, credits run out)</span>
            </label>
          </fieldset>
          <TimezoneField fallback={prefs.timezone} />
          <button className="btn-secondary">Save notification settings</button>
        </form>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Passkeys (sign in with your fingerprint)</h3>
        <p className="text-xs text-slate-500">Sign in with your phone&apos;s fingerprint, face or screen lock instead of your password and authenticator code. The passkey stays on your phone (backed up to your Google account), so it can&apos;t be phished or reused on another site.</p>
        <PasskeyAdd />
        {user.passkeys.length ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {user.passkeys.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span>{p.name} <span className="text-slate-500">· added {formatDate(p.createdAt)}{p.lastUsedAt ? ` · last used ${formatDate(p.lastUsedAt, true)}` : " · not used yet"}</span></span>
                <form action={removePasskey.bind(null, p.id)}><button className="text-xs text-red-700">Remove</button></form>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
