"use client";
import { useState } from "react";
import { DEFAULT_OFFER_DAYS, MAX_TRIAL_MONTHS, REP_MAX_TRIAL_MONTHS, describeOffer, firstYearSavingsCents, parseOffer, repLimitProblem } from "@/lib/offer-rules";
import { saveOffer } from "@/app/crm/offer-actions";
import { SubmitButton } from "./SubmitButton";

type Plan = { id: string; name: string; monthlyCents: number };
type Props = { accountId: string; plans: Plan[]; currency: "CAD" | "USD"; isAdmin: boolean; repCap: number };

const symbol = (c: "CAD" | "USD") => (c === "USD" ? "US$" : "CA$");

/** Account → Billing → Special offer: pick the offer, see it in plain words before saving. */
export function OfferForm({ accountId, plans, currency, isAdmin, repCap }: Props) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [kind, setKind] = useState("percent");
  const [value, setValue] = useState("");
  const [duration, setDuration] = useState("3");
  const [trialMonths, setTrialMonths] = useState("0");
  const [validDays, setValidDays] = useState(String(DEFAULT_OFFER_DAYS));
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const monthly = plan?.monthlyCents ?? 0;
  const parsed = plan && (value || kind === "none") ? parseOffer({ kind, value, duration, trialMonths, validDays }, monthly, currency) : null;
  const ok = parsed && !("error" in parsed) ? parsed : null;
  const limit = ok && !isAdmin ? repLimitProblem(ok, monthly, repCap) : null;
  const label = kind === "percent" ? "% off" : kind === "amount" ? `${symbol(currency)} off a month` : kind === "price" ? `Their monthly price (${symbol(currency)})` : "";

  return (
    <form action={saveOffer.bind(null, accountId)} className="space-y-2 text-sm">
      {plans.length > 1 ? (
        <select name="planId" value={planId} onChange={(e) => setPlanId(e.target.value)} className="input" aria-label="Plan">
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}: {symbol(currency)}{(p.monthlyCents / 100).toFixed(0)}/mo</option>)}
        </select>
      ) : <input type="hidden" name="planId" value={planId} />}
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="label">Offer</span>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
            <option value="percent">% off</option>
            <option value="amount">$ off a month</option>
            <option value="price">Set their monthly price</option>
            <option value="none">Free months only</option>
          </select>
        </label>
        {kind !== "none" ? (
          <label className="block"><span className="label">{label}</span><input name="value" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="input" placeholder={kind === "percent" ? "e.g. 25" : kind === "price" ? "e.g. 109" : "e.g. 30"} required /></label>
        ) : <span />}
        {kind !== "none" ? (
          <label className="block"><span className="label">For</span>
            <select name="duration" value={duration} onChange={(e) => setDuration(e.target.value)} className="input">
              {[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>first {m} month{m === 1 ? "" : "s"}</option>)}
              <option value="forever">as long as they stay</option>
            </select>
          </label>
        ) : null}
        <label className="block"><span className="label">Free months first</span>
          <select name="trialMonths" value={trialMonths} onChange={(e) => setTrialMonths(e.target.value)} className="input">
            {Array.from({ length: MAX_TRIAL_MONTHS + 1 }, (_, i) => <option key={i} value={i}>{i === 0 ? "none" : `${i} month${i === 1 ? "" : "s"}`}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Offer good for</span>
          <select name="validDays" value={validDays} onChange={(e) => setValidDays(e.target.value)} className="input">
            {[3, 7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
      </div>
      <input name="note" maxLength={300} className="input" placeholder="Note (optional), e.g. founding-client rate agreed on the call" />
      {ok ? (
        <p className="rounded-lg bg-emerald-50 p-2 text-emerald-900">
          <b>{describeOffer(ok, monthly)}</b>. Saves about {symbol(currency)}{Math.round(firstYearSavingsCents(ok, monthly) / 100)} in the first year on monthly billing.
        </p>
      ) : parsed && "error" in parsed ? <p className="text-red-700">{parsed.error}</p> : null}
      {limit ? <p className="text-amber-800">{limit}</p> : null}
      {!isAdmin ? <p className="text-xs text-slate-500">You can give up to {repCap}% off and {REP_MAX_TRIAL_MONTHS} free month on your own.</p> : null}
      <SubmitButton className="btn-secondary" pendingText="Saving…" disabled={!ok || Boolean(limit)}>Save offer</SubmitButton>
    </form>
  );
}
