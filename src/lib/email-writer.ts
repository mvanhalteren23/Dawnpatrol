import "server-only";
import { db } from "./db";
import { getSetting } from "./settings";
import { wasEdited } from "./utils";

export { wasEdited };

// What the email writer learns from: your style guide, recent feedback on drafts, edits you made
// before sending, and sent emails that got replies. Fed into every new draft.

export const STYLE_GUIDE_KEY = "email.styleGuide";
export const STYLE_PROPOSAL_KEY = "email.styleGuideProposal";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);


export async function writerGuidance(promptId: string | null): Promise<string> {
  const [guide, recent] = await Promise.all([
    getSetting(STYLE_GUIDE_KEY),
    db.emailDraft.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
  ]);
  const sentIds = recent.map((d) => d.sentActivityId).filter((x): x is string => Boolean(x));
  const replied = new Set(
    (await db.activity.findMany({ where: { id: { in: sentIds }, repliedAt: { not: null } }, select: { id: true } })).map((a) => a.id),
  );

  const feedback = [...new Set(recent.filter((d) => d.feedback?.trim()).map((d) => `${d.rating === 1 ? "(liked) " : d.rating === -1 ? "(disliked) " : ""}${d.feedback!.trim()}`))].slice(0, 8);
  const samePromptFirst = (a: { promptId: string | null }, b: { promptId: string | null }) => Number(b.promptId === promptId) - Number(a.promptId === promptId);
  const winners = recent
    .filter((d) => d.sentBody && (replied.has(d.sentActivityId ?? "") || d.rating === 1))
    .sort(samePromptFirst)
    .slice(0, 2);
  const edits = recent.filter((d) => d.sentBody && wasEdited(d.body, d.sentBody) && !winners.includes(d)).sort(samePromptFirst).slice(0, 2);

  const parts: string[] = [];
  if (guide?.trim()) parts.push(`House style guide (always follow):\n${guide.trim()}`);
  if (feedback.length) parts.push(`Feedback on recent drafts (apply it):\n${feedback.map((f) => `- ${f}`).join("\n")}`);
  for (const w of winners) {
    parts.push(`An email that worked${replied.has(w.sentActivityId ?? "") ? " (it got a reply)" : " (approved)"}. Match its tone and length, not its specifics:\nSubject: ${w.sentSubject}\n${clip(w.sentBody!, 1200)}`);
  }
  for (const e of edits) {
    parts.push(`A draft the user rewrote before sending. Learn from the changes:\nDRAFT:\n${clip(e.body, 900)}\nWHAT THEY SENT:\n${clip(e.sentBody!, 900)}`);
  }
  return parts.join("\n\n");
}

/** Material for proposing an updated style guide. */
export async function styleLearningMaterial(): Promise<{ guide: string; material: string; count: number }> {
  const guide = (await getSetting(STYLE_GUIDE_KEY)) ?? "";
  const drafts = await db.emailDraft.findMany({ where: { OR: [{ feedback: { not: null } }, { rating: { not: null } }, { sentBody: { not: null } }] }, orderBy: { createdAt: "desc" }, take: 40 });
  const sentIds = drafts.map((d) => d.sentActivityId).filter((x): x is string => Boolean(x));
  const replied = new Set((await db.activity.findMany({ where: { id: { in: sentIds }, repliedAt: { not: null } }, select: { id: true } })).map((a) => a.id));
  const material = drafts
    .map((d) => {
      const lines = [`Rating: ${d.rating === 1 ? "good" : d.rating === -1 ? "bad" : "none"}${d.sentActivityId && replied.has(d.sentActivityId) ? " · got a reply" : ""}`];
      if (d.feedback) lines.push(`Feedback: ${d.feedback}`);
      lines.push(`Draft:\n${clip(d.body, 700)}`);
      if (d.sentBody && wasEdited(d.body, d.sentBody)) lines.push(`Sent after editing:\n${clip(d.sentBody, 700)}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
  return { guide, material, count: drafts.length };
}
