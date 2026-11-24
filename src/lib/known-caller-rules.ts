// Known callers (pure; unit tested): numbers a client's line knows, with a name, the owner's note and
// how to handle the call. The list is filled by hand, from the call log, or by importing the
// client's customer list, so regulars are recognised from day one.
//
// Everything here can reach the agent's prompt, so it's cleaned the same way as caller memory:
// short, plain text only, nothing that reads like an instruction to the AI.

import Papa from "papaparse";
import { cleanFirstName } from "./caller-memory-rules";
import { looksLikeInstructions } from "./safety-rules";

export type Handling = "normal" | "vip" | "put_through" | "supplier" | "no_booking";
export const HANDLINGS: Handling[] = ["normal", "vip", "put_through", "supplier", "no_booking"];

export const HANDLING_LABEL: Record<Handling, string> = {
  normal: "Customer",
  vip: "VIP: extra care, messages marked urgent",
  put_through: "Always put through to my phone",
  supplier: "Supplier / partner: put through, no booking questions",
  no_booking: "Don't book: take a message",
};

/** Short tag for lists. */
export const HANDLING_TAG: Record<Handling, string> = { normal: "", vip: "VIP", put_through: "Put through", supplier: "Supplier", no_booking: "Don't book" };

export const NOTE_MAX = 140;
export const IMPORT_MAX_ROWS = 5000;

/** A saved or typed handling value; anything unknown is a normal customer. Accepts loose wording from a CSV. */
export function parseHandling(v: unknown): Handling {
  const s = String(v ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!s) return "normal";
  if (HANDLINGS.includes(s.replace(/ /g, "_") as Handling)) return s.replace(/ /g, "_") as Handling;
  if (/\b(vip|priority|important)\b/.test(s)) return "vip";
  if (/\b(supplier|vendor|partner|lender|underwriter|wholesale|parts|sub ?trade|subcontractor)\b/.test(s)) return "supplier";
  if (/\b(put through|transfer|always ring|ring me|direct|family|staff|crew)\b/.test(s)) return "put_through";
  if (/\b(no booking|dont book|do not book|don t book|blocked|owes|unpaid)\b/.test(s)) return "no_booking";
  return "normal";
}

/** The owner's note, safe for the prompt: one line, short, and never something that reads like an instruction to the AI. */
export function cleanNote(raw: string | null | undefined): string {
  const t = (raw ?? "").replace(/[\r\n\t]+/g, " ").replace(/[<>{}[\]`]/g, "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  return !t || looksLikeInstructions(t) ? "" : t;
}

/** Calls from these numbers ring the owner's phone first, whatever the line's ring-first hours. */
export function ringsOwnerFirst(h: Handling): boolean {
  return h === "put_through" || h === "supplier";
}

/** Known callers skip call protection's per-caller limits, except ones the owner doesn't want booked. */
export function trustedHandling(h: Handling): boolean {
  return h !== "no_booking";
}

/** What the agent is told to do for a known caller (fixed wording; never the owner's free text). */
export function handlingInstruction(h: Handling): string {
  switch (h) {
    case "vip":
      return "The owner marks this caller as a VIP: take extra care, and mark any message as urgent.";
    case "put_through":
      return "The owner wants this caller put through: if the owner didn't pick up, take a message and mark it urgent.";
    case "supplier":
      return "This is a supplier or business partner, not a customer: skip the booking questions and take a message for the owner (urgent if it's time-sensitive).";
    case "no_booking":
      return "Don't book appointments for this caller: take a message for the owner instead, and don't say why.";
    default:
      return "";
  }
}

export type OpenMessage = { at: Date; followedUpAt: Date | null } | null;

const DAY = 86_400_000;
/** Messages older than this aren't mentioned (the caller has probably moved on). */
export const MESSAGE_LOOKBACK_DAYS = 14;

function ago(then: Date, now: Date): string {
  const d = Math.floor((now.getTime() - then.getTime()) / DAY);
  return d <= 0 ? "earlier today" : d === 1 ? "yesterday" : `${d} days ago`;
}

/**
 * The status of the caller's last message, so the agent can answer "did you get my message?".
 * Only facts from our records (when, and whether the team marked it followed up), never what was said.
 */
export function messageStatusText(m: OpenMessage, now = new Date()): string {
  if (!m || now.getTime() - m.at.getTime() > MESSAGE_LOOKBACK_DAYS * DAY) return "";
  if (m.followedUpAt) return `They left a message ${ago(m.at, now)} and the team has followed up on it (${ago(m.followedUpAt, now)}). If they ask, say the team got back to them, and ask how else you can help.`;
  return `They left a message ${ago(m.at, now)} that the team hasn't marked as followed up yet. If they ask about it, say the team has it and will get back to them, and offer to add anything or mark it urgent. Don't promise a time.`;
}

export type KnownCaller = { firstName: string; label: string; notes: string; handling: Handling };

/** The known-caller lines for the agent's caller context. */
export function knownCallerText(k: KnownCaller | null): string[] {
  if (!k) return [];
  const out: string[] = [];
  const label = cleanNote(k.label).slice(0, 60);
  if (label && label.toLowerCase() !== k.firstName.toLowerCase()) out.push(`On the owner's list as: ${label}.`);
  const note = cleanNote(k.notes);
  if (note) out.push(`Owner's note: ${note}.`.replace(/\.\.$/, "."));
  const instruction = handlingInstruction(k.handling);
  if (instruction) out.push(instruction);
  return out;
}

// --- Importing a customer list ---------------------------------------------------

export type ImportedCaller = { phone: string; firstName: string; label: string; notes: string; handling: Handling };
export type CallerImport = { rows: ImportedCaller[]; skipped: number; duplicates: number; truncated: boolean };

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");
const PHONE_HEADERS = ["phone", "phonenumber", "mobile", "mobilephone", "cell", "cellphone", "telephone", "tel", "primaryphone", "homephone", "workphone", "phone1value", "phonenumber1"];
const FIRST_HEADERS = ["firstname", "first", "givenname", "fname"];
const LAST_HEADERS = ["lastname", "last", "surname", "familyname", "lname"];
const NAME_HEADERS = ["name", "fullname", "customer", "customername", "client", "clientname", "contact", "contactname", "displayname"];
const COMPANY_HEADERS = ["company", "companyname", "business", "organization", "organisation"];
const NOTE_HEADERS = ["notes", "note", "comments", "comment", "description"];
const TAG_HEADERS = ["tag", "tags", "type", "handling", "category", "group", "label"];

function pick(headers: string[], wanted: string[]): string | null {
  for (const w of wanted) {
    const h = headers.find((x) => norm(x) === w);
    if (h) return h;
  }
  return null;
}

/**
 * Parse a customer list (CSV from Jobber, Housecall Pro, QuickBooks, Google or phone contacts, or a
 * spreadsheet). Needs a phone column; a name, company, notes and tag column are used when present.
 * `toPhone` turns a typed number into E.164 (or null if it isn't a Canadian/US number).
 */
export function parseCallerCsv(text: string, toPhone: (raw: string) => string | null): CallerImport | { error: string } {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
  const headers = parsed.meta.fields ?? [];
  const phoneH = pick(headers, PHONE_HEADERS) ?? headers.find((h) => /phone|mobile|cell/i.test(h)) ?? null;
  if (!phoneH) return { error: "The file needs a column called Phone (or Mobile)." };
  const firstH = pick(headers, FIRST_HEADERS);
  const lastH = pick(headers, LAST_HEADERS);
  const nameH = pick(headers, NAME_HEADERS);
  const companyH = pick(headers, COMPANY_HEADERS);
  const noteH = pick(headers, NOTE_HEADERS);
  const tagH = pick(headers, TAG_HEADERS);

  const seen = new Set<string>();
  const rows: ImportedCaller[] = [];
  let skipped = 0;
  let duplicates = 0;
  const data = parsed.data;
  for (const row of data.slice(0, IMPORT_MAX_ROWS)) {
    const phone = toPhone((row[phoneH] ?? "").trim());
    if (!phone) {
      skipped++;
      continue;
    }
    if (seen.has(phone)) {
      duplicates++;
      continue;
    }
    seen.add(phone);
    const full = (nameH ? row[nameH] : "")?.trim() ?? "";
    const first = (firstH ? row[firstH]?.trim() : "") || full.split(/\s+/)[0] || "";
    const last = (lastH ? row[lastH]?.trim() : "") || (full.split(/\s+/).length > 1 ? full.split(/\s+/).slice(1).join(" ") : "");
    const company = (companyH ? row[companyH]?.trim() : "") ?? "";
    const person = [first, last].filter(Boolean).join(" ");
    const label = cleanNote([person, company && company !== person ? `(${company})` : ""].filter(Boolean).join(" ")).slice(0, 80);
    rows.push({
      phone,
      firstName: cleanFirstName(first) ?? "",
      label,
      notes: cleanNote(noteH ? row[noteH] : ""),
      handling: parseHandling(tagH ? row[tagH] : ""),
    });
  }
  return { rows, skipped, duplicates, truncated: data.length > IMPORT_MAX_ROWS };
}
