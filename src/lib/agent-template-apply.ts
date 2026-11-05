import "server-only";
import { db } from "./db";
import { recordKbChange } from "./kb-history";
import { AGENT_TEMPLATES, isCanadian, missingStarters, templateFor, templateGaps, templateSettings, type TemplateKey } from "./agent-templates";

// Applying agent templates (rules in agent-templates.ts).

/** A brand-new agent: the template's settings plus its starter knowledge (recorded in its history). */
export async function applyTemplateToNew(receptionistId: string, key?: TemplateKey | null) {
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, include: { account: { select: { industry: true, state: true } } } });
  const t = key ? AGENT_TEMPLATES[key] : templateFor(r.account.industry, r.agentType);
  const settings = templateSettings(t, { businessName: r.businessName, name: r.name, canadian: isCanadian({ state: r.account.state, timezone: r.timezone }) });
  await db.receptionist.update({
    where: { id: r.id },
    data: {
      ...settings,
      ...(r.agentType === "followup" ? { greeting: r.greeting } : {}),
      // A demo's bookings land in the rep's calendar, labelled with the prospect's name.
      ...(r.lifecycle === "demo" ? { bookingTitle: r.bookingTitle } : {}),
    },
  });
  await addStarters(r.id, t.key, []);
  return t;
}

/** An existing agent: fill only blank or factory-default settings, and add missing starters. */
export async function applyTemplateToExisting(receptionistId: string, key: TemplateKey, by: string | null) {
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, include: { knowledge: { select: { title: true } } } });
  const t = AGENT_TEMPLATES[key];
  const gaps = templateGaps(r as unknown as Record<string, unknown>, t, { businessName: r.businessName, name: r.name });
  if (Object.keys(gaps).length) await db.receptionist.update({ where: { id: r.id }, data: { ...gaps, ...(r.syncStatus === "SYNCED" ? { syncStatus: "DIRTY" } : {}) } });
  const added = await addStarters(r.id, key, r.knowledge.map((k) => k.title), by);
  return { settings: Object.keys(gaps).length, knowledge: added };
}

async function addStarters(receptionistId: string, key: TemplateKey, existing: string[], by: string | null = null) {
  const starters = missingStarters(AGENT_TEMPLATES[key], existing);
  await db.$transaction(async (tx) => {
    for (const k of starters) {
      const data = { receptionistId, category: k.category, title: k.title, content: k.content, tags: "template", isActive: k.active, updatedBy: by ?? "template" };
      const item = await tx.knowledgeItem.create({ data });
      await recordKbChange(tx, { receptionistId, itemId: item.id, action: "create", before: null, after: data, by: { email: by, role: "system" } });
    }
  });
  return starters.length;
}
