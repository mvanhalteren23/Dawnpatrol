// Saved prompts are templates with {{variables}}. Unknown variables render as empty strings
// so a prompt written for one account works for every account.

export type PromptAccount = {
  name: string;
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  notes?: string | null;
  employees?: number | null;
  contacts?: { firstName?: string | null; lastName?: string | null; title?: string | null; email?: string | null }[];
};

export const PROMPT_VARIABLES: { key: string; description: string }[] = [
  { key: "company", description: "Account name" },
  { key: "domain", description: "Normalised domain" },
  { key: "website", description: "Website URL" },
  { key: "industry", description: "Industry / vertical" },
  { key: "city", description: "City" },
  { key: "state", description: "State" },
  { key: "location", description: "City, State" },
  { key: "phone", description: "Main phone number" },
  { key: "employees", description: "Employee count" },
  { key: "notes", description: "Account notes" },
  { key: "contacts", description: "Known contacts (name — title — email)" },
  { key: "demo_phone", description: "Outreach: the demo line number (blank if this account has no demo yet)" },
  { key: "demo_extension", description: "Outreach: this account's demo extension (blank if none)" },
  { key: "criteria", description: "Prospecting: free-text criteria entered at run time" },
  { key: "count", description: "Prospecting: number of prospects requested" },
  { key: "today", description: "Today's date" },
];

export function accountVariables(account: PromptAccount): Record<string, string> {
  const location = [account.city, account.state].filter(Boolean).join(", ");
  const contacts = (account.contacts ?? [])
    .map((c) => [[c.firstName, c.lastName].filter(Boolean).join(" "), c.title, c.email].filter(Boolean).join(" — "))
    .filter(Boolean)
    .join("\n");
  return {
    company: account.name,
    domain: account.domain ?? "",
    website: account.website ?? (account.domain ? `https://${account.domain}` : ""),
    industry: account.industry ?? "",
    city: account.city ?? "",
    state: account.state ?? "",
    location,
    phone: account.phone ?? "",
    employees: account.employees != null ? String(account.employees) : "",
    notes: account.notes ?? "",
    contacts,
  };
}

export function renderPrompt(template: string, vars: Record<string, string | number | null | undefined>): string {
  const withToday = { today: new Date().toISOString().slice(0, 10), ...vars };
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const v = (withToday as Record<string, unknown>)[key];
    return v == null ? "" : String(v);
  });
}

export function templateVariables(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) found.add(m[1]!);
  return Array.from(found);
}

export const DEFAULT_PROMPTS: { name: string; kind: "RESEARCH" | "PROSPECTING" | "OUTREACH"; description: string; template: string; isDefault?: boolean }[] = [
  {
    name: "Missed-call opportunity audit",
    kind: "RESEARCH",
    isDefault: true,
    description: "Assess how much revenue {{company}} likely loses to unanswered calls and how an AI receptionist fits.",
    template: `Research {{company}} ({{website}}) — a {{industry}} business in {{location}}.

Find and summarise:
1. What they sell, typical job/ticket value, and who their customers are.
2. How inbound calls reach them today: phone numbers listed, hours, after-hours handling, online booking, answering service, chat widget.
3. Signals they miss calls or leads: reviews mentioning "never called back", "no answer", voicemail complaints; limited hours; small team; seasonal peaks.
4. Decision makers (owner / GM / office manager) with titles and any public contact info.
5. Competitors nearby and whether they offer 24/7 answering.
6. A recommended pitch angle for Dawn Patrol Co.'s AI receptionist, with an estimate of missed calls per week and the revenue at stake.

Known notes: {{notes}}
Known contacts:
{{contacts}}

Cite sources. Be concrete; say "unknown" rather than guessing.`,
  },
  {
    name: "Pre-call brief",
    kind: "RESEARCH",
    description: "One-page brief before a discovery call.",
    template: `Prepare a one-page pre-call brief on {{company}} ({{website}}, {{location}}).
Include: business overview, services, recent news or reviews, current phone/booking setup, likely objections to an AI receptionist, and three discovery questions tailored to them.`,
  },
  {
    name: "Local home-services SMBs",
    kind: "PROSPECTING",
    isDefault: true,
    description: "Find owner-operated service businesses that depend on inbound calls.",
    template: `Find {{count}} small/medium businesses that match: {{criteria}}.

Prioritise owner-operated businesses that depend on inbound phone calls (HVAC, plumbing, roofing, electrical, landscaping, dental, med-spa, legal intake, auto repair, property management).
Prefer businesses with signs of missed calls: limited office hours, no online booking, reviews about unanswered phones, 1-20 employees.
Only include real businesses you found on the web with a working website. Exclude franchises' corporate HQs and businesses that already advertise a 24/7 live answering service.`,
  },
  {
    name: "Cold email — missed calls",
    kind: "OUTREACH",
    description: "Short personalised first-touch email.",
    template: `Write a short (under 120 words) first-touch cold email to {{contacts}} at {{company}} ({{industry}}, {{location}}).
Angle: every unanswered call is a lost job. Dawn Patrol Co. builds AI receptionists that answer 24/7, book appointments and text the owner a summary.
Reference one specific detail about their business. One clear call to action. If a demo line is given ({{demo_phone}}, extension {{demo_extension}}), invite them to call it and hear their own AI receptionist answer as their business; otherwise offer a 15-minute demo. No hype, no emojis. Return a subject line and body.`,
  },
];
