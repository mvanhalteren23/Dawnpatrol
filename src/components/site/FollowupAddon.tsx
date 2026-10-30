import { FOLLOWUP_ADDON_PRICE, FOLLOWUP_EXAMPLES, type TradeKey } from "@/lib/site-content";
import { DemoButton } from "./Demo";
import { Eyebrow } from "./Sections";

// The Follow-Up Agent add-on: a website form comes in, and the agent calls the person back within
// minutes, asks the business's questions and books the next step.

const POINTS = [
  { title: "Called back in minutes", desc: "During your calling hours, every form gets a call within about five minutes. After hours, it calls as soon as you open." },
  { title: "Follows your rules", desc: "Asks your questions, sticks to the work and areas you cover, and never quotes a price you haven't approved." },
  { title: "Tries again, then texts", desc: "No answer? It tries again a couple of minutes later, then sends a text so the lead can call or reply." },
  { title: "Works with your current form", desc: "Connects to the form already on your website (Wix, WordPress, Squarespace and more), or we give you one." },
];

export function FollowupAddon({ trade = "contractors" }: { trade?: TradeKey }) {
  const ex = FOLLOWUP_EXAMPLES[trade];
  const timeline = [
    { time: "2:14 PM", label: "Website form sent", text: ex.form },
    { time: "2:16 PM", label: "Follow-Up Agent calls", text: ex.call },
    { time: "2:21 PM", label: "Booked", text: ex.booked },
  ];
  return (
    <section id="follow-up-agent" className="scroll-mt-24 border-y-2 border-[#1F3B2D] bg-[#173022] py-16 text-[#EFE6D4]">
      <div className="mx-auto grid max-w-7xl items-start gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
        <div className="space-y-6 lg:col-span-7">
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow dark>Add-on • Follow-Up Agent</Eyebrow>
          </div>
          <h2 style={{ lineHeight: 0.95 }} className="font-condensed-800 text-4xl text-[#EFE6D4] sm:text-[48px]">Every website lead called back within 5 minutes.</h2>
          <p className="max-w-2xl text-[18px] font-medium leading-[28px] text-[#EFE6D4]">
            The first business to call back usually wins the job. When someone fills in the form on your website, the Follow-Up Agent calls them, finds out what they need and books the estimate, drop-off or appointment—without you stopping work.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {POINTS.map((p) => (
              <div key={p.title} className="space-y-1.5 rounded-[12px] border border-[#6B5A43] bg-[#1F3B2D] p-5">
                <h3 className="font-condensed-700 text-2xl leading-[1.05] text-[#D8B47A]">{p.title}</h3>
                <p className="text-sm leading-relaxed text-[#EFE6D4]/90">{p.desc}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <DemoButton trade={trade} followup>Add the Follow-Up Agent</DemoButton>
            <span className="text-sm text-[#EFE6D4]/85">
              {FOLLOWUP_ADDON_PRICE ? <>Add to any plan for <strong className="text-[#D8B47A]">${FOLLOWUP_ADDON_PRICE}/month</strong>.</> : "Add it to any plan. Ask us for pricing."} Every lead, call summary and booking is in your dashboard.
            </span>
          </div>
        </div>

        <figure className="space-y-4 rounded-[20px] border-2 border-[#D8B47A] bg-[#EFE6D4] p-6 text-[#1F3B2D] lg:col-span-5">
          <figcaption className="flex items-center justify-between">
            <span style={{ letterSpacing: "0.15em" }} className="font-condensed-700 text-xs uppercase text-[#A87A33]">From form to booked in 7 minutes</span>
            <span className="text-xs font-semibold text-[#6B5A43]">Example</span>
          </figcaption>
          <ol className="space-y-4">
            {timeline.map((t, i) => (
              <li key={t.time} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span className="font-condensed-700 flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[#1F3B2D] text-sm text-[#D8B47A]">{i + 1}</span>
                  {i < timeline.length - 1 ? <span className="mt-1 w-0.5 flex-1 bg-[#6B5A43]/40" aria-hidden="true" /> : null}
                </div>
                <div className="pb-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-[#6B5A43]">{t.time} · {t.label}</div>
                  <p className="mt-1 text-sm font-medium leading-relaxed sm:text-base">{t.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </figure>
      </div>
    </section>
  );
}
