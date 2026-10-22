import Papa from "papaparse";
import { normalizeDomain, parseMoneyToCents, websiteUrl } from "./utils";

export type ImportField =
  | "name"
  | "website"
  | "phone"
  | "industry"
  | "city"
  | "state"
  | "employees"
  | "stage"
  | "tags"
  | "notes"
  | "avgJobValue"
  | "contactFirstName"
  | "contactLastName"
  | "contactName"
  | "contactTitle"
  | "contactEmail"
  | "contactPhone"
  | "contactLinkedin";

// Header aliases (lower-cased, punctuation stripped) — covers exports from Apollo, ZoomInfo,
// Google Maps scrapers, HubSpot and hand-built sheets.
const ALIASES: Record<ImportField, string[]> = {
  name: ["name", "company", "companyname", "account", "accountname", "business", "businessname", "organization", "organisation"],
  website: ["website", "url", "domain", "companywebsite", "companydomain", "site", "web"],
  phone: ["phone", "companyphone", "mainphone", "businessphone", "phonenumber", "telephone"],
  industry: ["industry", "vertical", "category", "type", "businesstype"],
  city: ["city", "town", "companycity"],
  state: ["state", "region", "province", "companystate"],
  employees: ["employees", "employeecount", "numberofemployees", "headcount", "companysize", "size"],
  stage: ["stage", "status", "lifecyclestage"],
  tags: ["tags", "labels", "list"],
  notes: ["notes", "note", "description", "comments"],
  avgJobValue: ["avgjobvalue", "averagejobvalue", "ticketsize", "avgticket", "dealvalue"],
  contactFirstName: ["firstname", "contactfirstname", "first"],
  contactLastName: ["lastname", "contactlastname", "last", "surname"],
  contactName: ["contact", "contactname", "fullname", "owner", "ownername", "person"],
  contactTitle: ["title", "jobtitle", "contacttitle", "position", "role"],
  contactEmail: ["email", "contactemail", "emailaddress", "workemail"],
  contactPhone: ["contactphone", "mobile", "mobilephone", "directphone", "cell"],
  contactLinkedin: ["linkedin", "linkedinurl", "personlinkedinurl", "contactlinkedin"],
};

const keyOf = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function guessMapping(headers: string[]): Partial<Record<ImportField, string>> {
  const mapping: Partial<Record<ImportField, string>> = {};
  const used = new Set<string>();
  for (const field of Object.keys(ALIASES) as ImportField[]) {
    const match = headers.find((h) => !used.has(h) && ALIASES[field].includes(keyOf(h)));
    if (match) {
      mapping[field] = match;
      used.add(match);
    }
  }
  return mapping;
}

export type ImportRow = {
  rowNumber: number;
  account: {
    name: string;
    domain: string | null;
    website: string | null;
    phone: string | null;
    industry: string | null;
    city: string | null;
    state: string | null;
    employees: number | null;
    stage: string | null;
    tags: string[];
    notes: string | null;
    avgJobValueCents: number | null;
  };
  contact: {
    firstName: string | null;
    lastName: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    linkedin: string | null;
  } | null;
};

export type ParsedImport = { headers: string[]; mapping: Partial<Record<ImportField, string>>; rows: ImportRow[]; errors: { row: number; message: string }[] };

export function parseAccountsCsv(text: string, mappingOverride?: Partial<Record<ImportField, string>>): ParsedImport {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
  const headers = parsed.meta.fields ?? [];
  const mapping = { ...guessMapping(headers), ...(mappingOverride ?? {}) };
  const get = (row: Record<string, string>, f: ImportField) => {
    const h = mapping[f];
    const v = h ? row[h] : undefined;
    return v && v.trim() ? v.trim() : null;
  };

  const rows: ImportRow[] = [];
  const errors: { row: number; message: string }[] = [];
  parsed.data.forEach((raw, i) => {
    const rowNumber = i + 2; // header is row 1
    const email = get(raw, "contactEmail")?.toLowerCase() ?? null;
    const websiteRaw = get(raw, "website");
    // Fall back to the email domain when there's no website column (skip free-mail domains).
    const emailDomain = normalizeDomain(email);
    const domain = normalizeDomain(websiteRaw) ?? (emailDomain && !FREE_MAIL.has(emailDomain) ? emailDomain : null);
    const name = get(raw, "name") ?? (domain ? domain.split(".")[0]! : null);
    if (!name) {
      errors.push({ row: rowNumber, message: "Missing company name and website" });
      return;
    }
    let firstName = get(raw, "contactFirstName");
    let lastName = get(raw, "contactLastName");
    const full = get(raw, "contactName");
    if (!firstName && !lastName && full) {
      const parts = full.split(/\s+/);
      firstName = parts.shift() ?? null;
      lastName = parts.join(" ") || null;
    }
    const contactFields = {
      firstName,
      lastName,
      title: get(raw, "contactTitle"),
      email,
      phone: get(raw, "contactPhone"),
      linkedin: get(raw, "contactLinkedin"),
    };
    const hasContact = Object.values(contactFields).some(Boolean);
    const employeesRaw = get(raw, "employees");
    const employees = employeesRaw ? parseInt(employeesRaw.replace(/[^0-9]/g, ""), 10) : NaN;
    rows.push({
      rowNumber,
      account: {
        name,
        domain,
        website: websiteUrl(websiteRaw) ?? (domain ? `https://${domain}` : null),
        phone: get(raw, "phone"),
        industry: get(raw, "industry"),
        city: get(raw, "city"),
        state: get(raw, "state"),
        employees: Number.isFinite(employees) ? employees : null,
        stage: normaliseStage(get(raw, "stage")),
        tags: (get(raw, "tags") ?? "").split(/[,;|]/).map((t) => t.trim()).filter(Boolean),
        notes: get(raw, "notes"),
        avgJobValueCents: parseMoneyToCents(get(raw, "avgJobValue")),
      },
      contact: hasContact ? contactFields : null,
    });
  });
  for (const e of parsed.errors) errors.push({ row: (e.row ?? 0) + 2, message: e.message });
  return { headers, mapping, rows, errors };
}

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "live.com", "msn.com", "comcast.net", "proton.me", "protonmail.com"]);

const STAGE_ALIASES: Record<string, string> = {
  prospect: "PROSPECT", lead: "PROSPECT", new: "PROSPECT",
  contacted: "CONTACTED", attempted: "CONTACTED",
  engaged: "ENGAGED", replied: "ENGAGED", interested: "ENGAGED",
  demo: "DEMO", meeting: "DEMO",
  proposal: "PROPOSAL", quote: "PROPOSAL",
  onboarding: "ONBOARDING",
  active: "ACTIVE", customer: "ACTIVE", client: "ACTIVE",
  churned: "CHURNED", cancelled: "CHURNED", canceled: "CHURNED",
  lost: "LOST", dead: "LOST", disqualified: "LOST",
};

function normaliseStage(v: string | null): string | null {
  if (!v) return null;
  return STAGE_ALIASES[keyOf(v)] ?? null;
}

/** Collapse rows that refer to the same company inside one file (same domain, or same name+city). */
export function dedupeKey(row: ImportRow): string {
  return row.account.domain ?? `${row.account.name.toLowerCase()}|${(row.account.city ?? "").toLowerCase()}`;
}
