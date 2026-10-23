import "server-only";
import { db } from "./db";
import { getSetting, setSetting } from "./settings";

// The agency's own name, used across the CRM, portal, Claude prompts and the demo line.
// Change it in CRM → Settings (no redeploy); COMPANY_NAME is the fallback for a fresh install.

const KEY = "company.name";
export const DEFAULT_COMPANY_NAME = "Head Above Digital";

export async function companyName(): Promise<string> {
  // Static pages (e.g. the 404) render at build time, when there may be no database to read.
  const saved = await getSetting(KEY).catch(() => null);
  return saved?.trim() || process.env.COMPANY_NAME?.trim() || DEFAULT_COMPANY_NAME;
}

function replaceAll(text: string, from: string, to: string): string {
  return text.split(from).join(to);
}

/**
 * Rename the company. With `rewrite`, also swaps the old name for the new one in the text you
 * maintain: saved prompts, the demo line greeting, and your own account (the one named after the
 * company), its receptionists and knowledge base. Returns how many records changed.
 */
export async function renameCompany(next: string, rewrite: boolean): Promise<number> {
  const prev = await companyName();
  await setSetting(KEY, next);
  if (!rewrite || !prev || prev === next) return 0;
  let changed = 0;

  for (const p of await db.savedPrompt.findMany({ where: { OR: [{ template: { contains: prev } }, { description: { contains: prev } }, { name: { contains: prev } }] } })) {
    await db.savedPrompt.update({ where: { id: p.id }, data: { name: replaceAll(p.name, prev, next), description: replaceAll(p.description ?? "", prev, next), template: replaceAll(p.template, prev, next) } });
    changed++;
  }

  const greeting = await getSetting("demo.greeting");
  if (greeting?.includes(prev)) {
    await setSetting("demo.greeting", replaceAll(greeting, prev, next));
    changed++;
  }

  const own = await db.account.findMany({ where: { name: { contains: prev } }, include: { receptionists: { include: { knowledge: true } } } });
  for (const a of own) {
    await db.account.update({ where: { id: a.id }, data: { name: replaceAll(a.name, prev, next), notes: replaceAll(a.notes, prev, next) } });
    changed++;
    for (const r of a.receptionists) {
      const fields = ["businessName", "greeting", "persona", "businessHours", "escalationRules", "extraInstructions", "bookingTitle", "bookingQuestions"] as const;
      const data = Object.fromEntries(fields.map((f) => [f, replaceAll(r[f], prev, next)]));
      await db.receptionist.update({ where: { id: r.id }, data: { ...data, ...(r.syncStatus === "SYNCED" ? { syncStatus: "DIRTY" } : {}) } });
      changed++;
      for (const k of r.knowledge.filter((k) => k.title.includes(prev) || k.content.includes(prev))) {
        await db.knowledgeItem.update({ where: { id: k.id }, data: { title: replaceAll(k.title, prev, next), content: replaceAll(k.content, prev, next) } });
        changed++;
      }
    }
  }
  return changed;
}
