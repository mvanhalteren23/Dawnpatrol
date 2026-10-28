import "server-only";
import { db } from "./db";
import { dedupeKey, parseAccountsCsv, type ImportRow } from "./csv";
import { joinTags, splitTags } from "./utils";
import { DuplicateIndex } from "./team-rules";

export type ImportOptions = {
  defaultTags?: string[];
  ownerId?: string | null;
  source?: string;
  updateExisting?: boolean;
  /** May the importer fill in an existing account with this owner? (Reps: only their own or unassigned.) */
  canUpdate?: (ownerId: string | null) => boolean;
};


/** Upsert accounts + contacts. Existing accounts (same domain, phone, or name+city) only get blanks filled and tags merged. */
export async function importRows(rows: ImportRow[], opts: ImportOptions = {}) {
  let created = 0;
  const createdIds: string[] = [];
  let updated = 0;
  let skipped = 0;
  const errors: { row: number; message: string }[] = [];
  const seen = new Map<string, string>(); // dedupeKey -> accountId (within this file)
  const locked = new Set<string>(); // another rep's accounts: leave them (and their contacts) alone
  // The same business already in the CRM (domain, phone, or name in the same city) is never added
  // twice. Load every account once rather than querying per row; accounts created by this file
  // are added as we go, so a later row with the same phone also matches.
  const existingIndex = new DuplicateIndex(await db.account.findMany());

  for (const row of rows) {
    try {
      const key = dedupeKey(row);
      let accountId = seen.get(key);
      if (!accountId) {
        const existing = existingIndex.find(row.account);
        const tags = joinTags([...row.account.tags, ...(opts.defaultTags ?? [])]);
        if (existing) {
          const othersAccount = Boolean(opts.canUpdate && !opts.canUpdate(existing.ownerId));
          if (othersAccount) locked.add(existing.id);
          if (opts.updateExisting === false || othersAccount) {
            skipped++;
            seen.set(key, existing.id);
            accountId = existing.id;
          } else {
            const saved = await db.account.update({
              where: { id: existing.id },
              data: {
                website: existing.website ?? row.account.website,
                phone: existing.phone ?? row.account.phone,
                industry: existing.industry ?? row.account.industry,
                city: existing.city ?? row.account.city,
                state: existing.state ?? row.account.state,
                employees: existing.employees ?? row.account.employees,
                avgJobValueCents: existing.avgJobValueCents ?? row.account.avgJobValueCents,
                tags: joinTags([...splitTags(existing.tags), ...splitTags(tags)]),
                notes: row.account.notes && !existing.notes.includes(row.account.notes) ? `${existing.notes}\n${row.account.notes}`.trim() : existing.notes,
              },
            });
            // Later rows in this file see the filled-in fields (and match on a newly added phone).
            Object.assign(existing, saved);
            existingIndex.add(existing);
            updated++;
            accountId = existing.id;
          }
        } else {
          const a = await db.account.create({
            data: {
              name: row.account.name,
              domain: row.account.domain,
              website: row.account.website,
              phone: row.account.phone,
              industry: row.account.industry,
              city: row.account.city,
              state: row.account.state,
              employees: row.account.employees,
              stage: row.account.stage ?? "PROSPECT",
              tags,
              notes: row.account.notes ?? "",
              avgJobValueCents: row.account.avgJobValueCents,
              source: opts.source ?? "import",
              ownerId: opts.ownerId ?? null,
            },
          });
          existingIndex.add(a);
          created++;
          createdIds.push(a.id);
          accountId = a.id;
        }
        seen.set(key, accountId);
      } else {
        // Same company again in this file: likely another contact.
      }

      if (row.contact && !locked.has(accountId)) {
        const c = row.contact;
        const dup = c.email
          ? await db.contact.findFirst({ where: { accountId, email: c.email } })
          : await db.contact.findFirst({ where: { accountId, firstName: c.firstName, lastName: c.lastName } });
        if (!dup) {
          const count = await db.contact.count({ where: { accountId } });
          await db.contact.create({ data: { accountId, ...c, isPrimary: count === 0 } });
        }
      }
    } catch (err) {
      errors.push({ row: row.rowNumber, message: (err as Error).message });
    }
  }
  return { created, createdIds, updated, skipped, errors };
}

export async function importCsvText(filename: string, text: string, opts: ImportOptions & { createdById?: string }) {
  const parsed = parseAccountsCsv(text);
  const result = await importRows(parsed.rows, opts);
  const job = await db.importJob.create({
    data: {
      filename,
      total: parsed.rows.length + parsed.errors.length,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: JSON.stringify([...parsed.errors, ...result.errors].slice(0, 200)),
      createdById: opts.createdById ?? null,
    },
  });
  return { job, mapping: parsed.mapping, createdIds: result.createdIds };
}
