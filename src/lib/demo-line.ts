import "server-only";
import { db } from "./db";
import { getSetting } from "./settings";
import { companyName } from "./brand";

export const defaultDemoGreeting = (company: string) =>
  `Thanks for calling the ${company} demo line. Please enter the demo extension from your email, then press pound.`;

export async function demoLineConfig() {
  const [greeting, fallbackReceptionistId, company] = await Promise.all([getSetting("demo.greeting"), getSetting("demo.fallbackReceptionistId"), companyName()]);
  const defaultGreeting = defaultDemoGreeting(company);
  return {
    number: process.env.TWILIO_DEMO_NUMBER ?? "",
    greeting: greeting || defaultGreeting,
    defaultGreeting,
    fallbackReceptionistId: fallbackReceptionistId || null,
  };
}

/** "+17786504870" -> "(778) 650-4870" for emails and the UI. */
export function formatPhone(e164: string): string {
  const d = e164.replace(/[^0-9]/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

export async function demoExtensionForAccount(accountId: string): Promise<string | null> {
  const r = await db.receptionist.findFirst({ where: { accountId, demoExtension: { not: null } }, orderBy: { createdAt: "asc" } });
  return r?.demoExtension ?? null;
}
