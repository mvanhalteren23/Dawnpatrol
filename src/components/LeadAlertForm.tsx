import type { Receptionist } from "@prisma/client";
import { LeadAlertFields } from "@/components/ReceptionistOptions";
import { SubmitButton } from "@/components/SubmitButton";
import { saveLeadAlerts } from "@/app/receptionist-actions";

/** The client's own choice of which calls text them, and where. */
export function LeadAlertForm({ r, returnTo }: { r: Pick<Receptionist, "id" | "leadAlertOn" | "leadAlertTo" | "ringFirstNumber" | "businessNumber">; returnTo: string }) {
  return (
    <form action={saveLeadAlerts.bind(null, r.id, returnTo)} className="card grid grid-cols-2 gap-3">
      <h2 className="col-span-2">Lead texts to you</h2>
      <LeadAlertFields r={r} />
      <div className="col-span-2"><SubmitButton pendingText="Saving…">Save lead texts</SubmitButton></div>
    </form>
  );
}
