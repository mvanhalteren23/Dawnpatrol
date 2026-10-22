import { describe, expect, it } from "vitest";
import { dedupeKey, guessMapping, parseAccountsCsv } from "@/lib/csv";

describe("csv import", () => {
  it("guesses common header names", () => {
    const m = guessMapping(["Company Name", "Website", "First Name", "Last Name", "Email", "Job Title", "City", "State"]);
    expect(m).toMatchObject({ name: "Company Name", website: "Website", contactFirstName: "First Name", contactEmail: "Email", contactTitle: "Job Title" });
  });

  it("normalises rows, splits full names and falls back to email domain", () => {
    const csv = `Company,Email,Contact,Employees,Stage,Tags
Acme Plumbing,bob@acmeplumbing.com,Bob J Smith,"1,200",customer,hvac;priority
,jane@sunrisedental.co,Jane Doe,,,`;
    const { rows, errors } = parseAccountsCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]!.account).toMatchObject({ name: "Acme Plumbing", domain: "acmeplumbing.com", employees: 1200, stage: "ACTIVE", tags: ["hvac", "priority"] });
    expect(rows[0]!.contact).toMatchObject({ firstName: "Bob", lastName: "J Smith", email: "bob@acmeplumbing.com" });
    expect(rows[1]!.account.name).toBe("sunrisedental");
  });

  it("does not use free-mail domains as company domains", () => {
    const { rows } = parseAccountsCsv(`Company,Email\nJoe's Roofing,joe@gmail.com`);
    expect(rows[0]!.account.domain).toBeNull();
    expect(dedupeKey(rows[0]!)).toBe("joe's roofing|");
  });

  it("reports rows with no company and no website", () => {
    const { rows, errors } = parseAccountsCsv(`Company,Email\n,someone@gmail.com`);
    expect(rows).toHaveLength(0);
    expect(errors[0]!.row).toBe(2);
  });
});
