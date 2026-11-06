import "server-only";
import { db } from "./db";
import { recordKbChange } from "./kb-history";
import { recordActivity } from "./outreach";
import { cleanQuestions } from "./discovery-rules";
import { DEMO_RESEARCH_TAG, profileReport, profileToKnowledge, profileToSettings, type DemoProfile } from "./demo-research-rules";

// Demo agent research (Research card on an account): deep research on the prospect that builds
// their demo agent, or refreshes an existing one. Rules live in demo-research-rules.ts.

type Input = { receptionistId: string | null; createdById: string | null; googleUserId: string | null; bookingEnabled: boolean; agentName: string };

/** Queue a run; the caller runs executeDemoResearch after responding. */
export async function startDemoResearch(accountId: string, o: Input): Promise<string> {
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { website: true, domain: true, name: true, city: true, state: true } });
  if (!account.website && !account.domain && !account.city) throw new Error("Add the prospect's website (or at least their city) first, so the research can find the right business");
  if (o.receptionistId) {
    const r = await db.receptionist.findFirst({ where: { id: o.receptionistId, accountId }, select: { lifecycle: true } });
    if (!r) throw new Error("That agent isn't on this account");
    if (r.lifecycle !== "demo") throw new Error("Demo agent research only updates demo agents, never a live client's agent");
  }
  const run = await db.researchRun.create({ data: { kind: "DEMO_RESEARCH", accountId, input: JSON.stringify(o) } });
  return run.id;
}

export async function executeDemoResearch(runId: string) {
  const run = await db.researchRun.findUniqueOrThrow({ where: { id: runId }, include: { account: true } });
  const o = JSON.parse(run.input) as Input;
  const account = run.account!;
  try {
    const { researchForDemoAgent } = await import("./ai");
    const website = account.website ?? (account.domain ? `https://${account.domain}` : null);
    const result = await researchForDemoAgent({
      businessName: account.name,
      website,
      location: [account.city, account.state].filter(Boolean).join(", "),
      industry: account.industry ?? "",
      notes: account.notes ?? "",
    });
    const profile = result.profile;
    const receptionistId = await buildAgent(account.id, o, profile);
    await db.researchRun.update({
      where: { id: runId },
      data: {
        status: "DONE",
        output: `${profileReport(profile)}\n\n---\n\n## Full research notes\n\n${result.text}`,
        resultJson: JSON.stringify({ receptionistId, profile }),
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    console.error(`demo research ${runId} failed`, err);
    await db.researchRun.update({ where: { id: runId }, data: { status: "FAILED", error: (err as Error).message?.slice(0, 2000) ?? String(err), finishedAt: new Date() } });
  }
}

/** Create the demo agent (or reuse the chosen one), load the research into it, and sync. */
async function buildAgent(accountId: string, o: Input, profile: DemoProfile): Promise<string> {
  let receptionistId = o.receptionistId;
  if (!receptionistId) {
    const { createDemoAgent } = await import("./demo-builder");
    const { receptionist } = await createDemoAgent(accountId, { name: o.agentName, createdById: o.createdById, googleUserId: o.googleUserId, bookingEnabled: o.bookingEnabled, skipKbDraft: true });
    receptionistId = receptionist.id;
  }
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId } });
  const entries = profileToKnowledge(profile);
  const by = { email: "demo research", role: "system" };
  await db.$transaction(async (tx) => {
    // A re-run replaces what the last research added; the team's own entries stay.
    const old = await tx.knowledgeItem.findMany({ where: { receptionistId: r.id, tags: { contains: DEMO_RESEARCH_TAG } } });
    for (const item of old) {
      await tx.knowledgeItem.delete({ where: { id: item.id } });
      await recordKbChange(tx, { receptionistId: r.id, itemId: item.id, action: "delete", before: item, after: null, by });
    }
    for (const e of entries) {
      const data = { receptionistId: r.id, ...e, updatedBy: "demo research" };
      const item = await tx.knowledgeItem.create({ data });
      await recordKbChange(tx, { receptionistId: r.id, itemId: item.id, action: "create", before: null, after: data, by });
    }
  });
  await db.receptionist.update({ where: { id: r.id }, data: { ...profileToSettings(profile, { agentName: r.name }), businessName: profile.match === "confirmed" ? profile.business.name : r.businessName, syncStatus: "DIRTY" } });
  // The owner questions become the questions asked on the phone after they book a demo.
  const questions = cleanQuestions(profile.ownerQuestions);
  if (questions.length) await db.account.update({ where: { id: accountId }, data: { discoveryQuestions: JSON.stringify(questions) } });

  const { syncReceptionist } = await import("./elevenlabs");
  let synced = true;
  await syncReceptionist(r.id).catch((e) => { synced = false; console.error("demo research sync", e); });
  const assumed = entries.filter((e) => e.tags.includes("assumed")).length;
  const { demoLineConfig, formatPhone } = await import("./demo-line");
  const { number } = await demoLineConfig();
  await recordActivity({
    accountId,
    type: "NOTE",
    source: "system",
    subject: o.receptionistId ? "Demo agent refreshed from research" : "Demo agent built from research",
    body: `${entries.length} knowledge entries from research (${assumed} assumed for their trade: confirm with the owner).${synced ? "" : " The ElevenLabs sync failed: open the agent and press Sync."} Call ${number ? formatPhone(number) : "the demo line"}, extension ${r.demoExtension}, to hear ${r.name} answer for ${r.businessName}.`,
    createdById: o.createdById,
  });
  return r.id;
}
