import { requireStaff } from "@/lib/auth";
import { parseShare } from "@/lib/share-rules";
import { findDuplicateAccount } from "@/lib/team";
import { normalizeDomain } from "@/lib/utils";
import { Flash } from "@/components/Flash";
import { SubmitButton } from "@/components/SubmitButton";
import { addSharedBusiness } from "./actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Share target: Google Maps → Share → Head Above (or a website in Chrome → Share). The details are
// pre-filled; one tap adds the account, researches it and can build the demo agent.

export default async function SharePage({ searchParams }: { searchParams: Promise<{ title?: string; text?: string; url?: string; error?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  const b = parseShare({ title: sp.title, text: sp.text, url: sp.url });
  const dup = b.name || b.website || b.phone ? await findDuplicateAccount({ domain: normalizeDomain(b.website), phone: b.phone, name: b.name, city: b.city }) : null;
  const nothing = !sp.title && !sp.text && !sp.url;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1>Add a business</h1>
      <Flash params={{ error: sp.error }} />
      {nothing ? (
        <p className="text-sm text-slate-600">In Google Maps, open a business and tap <b>Share → Head Above</b>. From a website in Chrome, tap <b>⋮ → Share → Head Above</b>. The details land here, ready to add.</p>
      ) : null}
      {dup ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p><b>{dup.name}</b> is already in the CRM ({dup.reason}), owned by {dup.owner}.</p>
          <Link href={`/crm/accounts/${dup.id}`} className="btn mt-3 min-h-11 justify-center hover:no-underline">Open it</Link>
        </div>
      ) : null}
      <form action={addSharedBusiness} className="card space-y-3">
        <label className="block"><span className="label">Business name</span><input name="name" defaultValue={b.name} required className="input py-3 text-base" /></label>
        <label className="block"><span className="label">Website</span><input name="website" type="url" inputMode="url" defaultValue={b.website ?? ""} placeholder="https://" className="input py-3 text-base" /></label>
        <label className="block"><span className="label">Phone</span><input name="phone" type="tel" inputMode="tel" defaultValue={b.phone ?? ""} className="input py-3 text-base" /></label>
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <label className="block"><span className="label">City</span><input name="city" defaultValue={b.city ?? ""} className="input py-3 text-base" /></label>
          <label className="block"><span className="label">Prov.</span><input name="state" defaultValue={b.state ?? ""} maxLength={2} className="input py-3 text-base uppercase" /></label>
        </div>
        <label className="block"><span className="label">Trade (optional)</span><input name="industry" placeholder="e.g. Plumbing" className="input py-3 text-base" /></label>
        <label className="block"><span className="label">Note (optional)</span><textarea name="note" rows={2} placeholder="e.g. Drove past, busy shop, owner is Dave" className="input text-base" /></label>
        {b.address ? <p className="text-xs text-slate-500">Address: {b.address}</p> : null}
        <input type="hidden" name="address" value={b.address ?? ""} />
        <input type="hidden" name="mapsUrl" value={b.mapsUrl ?? ""} />
        <input type="hidden" name="otherUrl" value={b.otherUrl ?? ""} />
        <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
          <input type="checkbox" name="buildDemo" defaultChecked className="mt-0.5 h-5 w-5" />
          <span className="text-sm"><b>Build their demo receptionist</b><span className="block text-xs text-slate-500">Researches the business and sets up a demo agent you can play for them. Needs a website or city.</span></span>
        </label>
        <SubmitButton className="btn min-h-12 w-full text-base" pendingText="Adding…">Add to Head Above</SubmitButton>
      </form>
    </div>
  );
}
