import "server-only";
import { db } from "./db";
import { dedupeKey, parseAccountsCsv, type ImportRow } from "./csv";
import { joinTags, splitTags } from "./utils";

export type ImportOptions = { defaultTags?: string[]; ownerId?: string | null; source?: string; updateExisting?: boolean };

async function findExisting(row: ImportRow["account"]) {
  if (row.domain) {
    const byDomain = await db.account.findUnique({ where: { domain: row.domain } });
    if (byDomain) return byDomain;
  }
  return db.account.findFirst({ where: { name: row.name, ...(row.city ? { city: row.city } : {}) } });
}

/** Upsert accounts + contacts. Existing accounts (same domain, or same name+city) only get blanks filled and tags merged. */
export async function importRows(rows: ImportRow[], opts: ImportOptions = {}) {
  let created = 0;
  const createdIds: string[] = [];
  let updated = 0;
  let skipped = 0;
  const errors: { row: number; message: string }[] = [];
  const seen = new Map<string, string>(); // dedupeKey -> accountId (within this file)

  for (const row of rows) {
    try {
      const key = dedupeKey(row);
      let accountId = seen.get(key);
      if (!accountId) {
        const existing = await findExisting(row.account);
        const tags = joinTags([...row.account.tags, ...(opts.defaultTags ?? [])]);
        if (existing) {
          if (opts.updateExisting === false) {
            skipped++;
            seen.set(key, existing.id);
            accountId = existing.id;
          } else {
            await db.account.update({
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
          created++;
          createdIds.push(a.id);
          accountId = a.id;
        }
        seen.set(key, accountId);
      } else {
        // Same company again in this file: likely another contact.
      }

      if (row.contact) {
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
