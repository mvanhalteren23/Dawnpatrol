// Drop researched details the report itself doesn't back up (pure; unit tested).
// The extraction model can still invent a plausible phone, email or website; anything that
// doesn't literally appear in the research report text is removed before it reaches the CRM.

import type { ResearchSummary } from "./ai";
import { normalizeDomain } from "./utils";

const digits = (s: string) => s.replace(/\D/g, "");

function phoneInReport(phone: string | null, reportDigits: string): string | null {
  if (!phone) return null;
  const d = digits(phone).slice(-10);
  return d.length >= 7 && reportDigits.includes(d) ? phone : null;
}

export function verifySummary(s: ResearchSummary, report: string): ResearchSummary {
  const text = report.toLowerCase();
  const reportDigits = digits(report);
  const domain = normalizeDomain(s.website);
  return {
    ...s,
    website: domain && text.includes(domain) ? s.website : null,
    phone: phoneInReport(s.phone, reportDigits),
    decisionMakers: s.decisionMakers
      .filter((dm) => dm.name.trim() && text.includes(dm.name.trim().toLowerCase()))
      .map((dm) => ({
        ...dm,
        email: dm.email && text.includes(dm.email.toLowerCase()) ? dm.email : null,
        phone: phoneInReport(dm.phone, reportDigits),
        linkedin: dm.linkedin && text.includes(dm.linkedin.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")) ? dm.linkedin : null,
      })),
  };
}
