import { SubmitButton } from "@/components/SubmitButton";
import { requestChange } from "@/app/receptionist-actions";

const TOPICS = ["Services or prices", "Hours, holidays or closures", "How calls are handled", "Booking and appointments", "Phone number or forwarding", "Something else"];

/** Clients tell the team what to change; the team updates and tests the agent (managed service). */
export function RequestChangeForm({ receptionistId, returnTo, defaultTopic }: { receptionistId: string; returnTo: string; defaultTopic?: string }) {
  return (
    <form action={requestChange.bind(null, receptionistId, returnTo)} className="card space-y-3">
      <div>
        <h2>Request a change</h2>
        <p className="text-xs text-slate-500">Tell us what&apos;s new or different. We update your receptionist, test it, and let you know when it&apos;s live, usually within one business day.</p>
      </div>
      <select name="topic" defaultValue={defaultTopic ?? TOPICS[0]} className="input" aria-label="What it's about">
        {TOPICS.map((t) => <option key={t}>{t}</option>)}
      </select>
      <textarea name="request" rows={4} required minLength={5} maxLength={4000} className="input" placeholder="e.g. We now offer gutter cleaning from $149. We're closed Dec 24 to Jan 2. Send emergency calls to Sam at 604-555-0100." />
      <SubmitButton pendingText="Sending…">Send request</SubmitButton>
    </form>
  );
}
