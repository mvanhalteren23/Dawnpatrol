"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { optInt, str } from "@/lib/utils";

const date = (form: FormData, key: string) => {
  const v = str(form, key);
  return v ? new Date(`${v}T12:00:00`) : null;
};

function fields(form: FormData) {
  const risk = str(form, "realRiskOfHarm");
  return {
    title: str(form, "title").slice(0, 200),
    discoveredAt: date(form, "discoveredAt") ?? new Date(),
    occurredAt: date(form, "occurredAt"),
    description: str(form, "description").slice(0, 5000),
    dataInvolved: str(form, "dataInvolved").slice(0, 2000),
    peopleAffected: optInt(form, "peopleAffected"),
    realRiskOfHarm: ["yes", "no", "unknown"].includes(risk) ? risk : "unknown",
    containment: str(form, "containment").slice(0, 5000),
    individualsNotifiedAt: date(form, "individualsNotifiedAt"),
    regulatorNotifiedAt: date(form, "regulatorNotifiedAt"),
    clientsNotifiedAt: date(form, "clientsNotifiedAt"),
    status: str(form, "status") === "CLOSED" ? "CLOSED" : "OPEN",
  };
}

export async function createIncident(form: FormData) {
  const session = await requireAdmin();
  if (!str(form, "title")) redirect("/crm/security?error=Give the incident a short title");
  await db.securityIncident.create({ data: { ...fields(form), createdById: session.sub } });
  revalidatePath("/crm/security");
  redirect("/crm/security?notice=Incident recorded");
}

export async function updateIncident(id: string, form: FormData) {
  await requireAdmin();
  await db.securityIncident.update({ where: { id }, data: fields(form) });
  revalidatePath("/crm/security");
  redirect("/crm/security?notice=Incident updated");
}
