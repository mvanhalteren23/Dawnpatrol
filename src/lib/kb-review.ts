import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { appUrl } from "./app-url";
import { linkState, REVIEW_DAYS, validToken } from "./kb-review-rules";

// Client knowledge-base review links (rules in kb-review-rules.ts).

export function reviewUrl(token: string): string {
  return `${appUrl()}/review/${token}`;
}

/** A new link for this agent; earlier links stay usable until they expire or are revoked. */
export async function createReviewLink(receptionistId: string, o: { by: string | null; sentTo?: string | null }) {
  return db.kbReviewLink.create({
    data: { receptionistId, token: randomBytes(24).toString("base64url"), createdBy: o.by, sentTo: o.sentTo ?? null, expiresAt: new Date(Date.now() + REVIEW_DAYS * 86400_000) },
  });
}

/** The link and its agent, if the link is still usable. */
export async function openReviewLink(token: string) {
  if (!validToken(token)) return null;
  const link = await db.kbReviewLink.findUnique({ where: { token }, include: { receptionist: { include: { account: { select: { id: true, name: true } } } } } });
  if (!link || linkState(link) !== "active") return null;
  return link;
}

export type ReviewSend = { email?: string | null; phone?: string | null; firstName?: string | null };
export type ReviewSent = { url: string; emailed: string | null; texted: string | null; problems: string[] };

/**
 * Create a review link for this agent and send it by email, text, or both. Sending problems are
 * reported (the link still exists, so it can be copied). Texts go from the company line and skip
 * anyone who has texted STOP to it.
 */
export async function sendReviewLink(
  receptionistId: string,
  to: ReviewSend,
  by: { email: string; sub: string | null },
): Promise<ReviewSent> {
  const r = await db.receptionist.findUniqueOrThrow({ where: { id: receptionistId }, select: { id: true, name: true, businessName: true, accountId: true } });
  const email = to.email?.trim().toLowerCase() || null;
  const { dialableNumber } = await import("./twilio");
  const phone = to.phone ? dialableNumber(to.phone) : null;
  const sentTo = [email, phone].filter(Boolean).join(" / ") || null;
  const link = await createReviewLink(receptionistId, { by: by.email, sentTo });
  const url = reviewUrl(link.token);
  const { companyName } = await import("./brand");
  const company = await companyName();
  const first = to.firstName?.trim().split(/\s+/)[0] || "";
  const waiting = await db.knowledgeItem.count({ where: { receptionistId, OR: [{ isActive: false }, { tags: { contains: "assumed" } }, { content: { startsWith: "TO FILL IN" } }] } });
  const problems: string[] = [];
  let emailed: string | null = null;
  let texted: string | null = null;

  if (email) {
    try {
      const { sendPlainEmail } = await import("./outreach");
      const { googleConnection } = await import("./google");
      const mine = by.sub ? await googleConnection(by.sub) : { connected: false };
      await sendPlainEmail({
        to: email,
        subject: `Quick review: what your AI receptionist knows about ${r.businessName}`,
        body: `Hi${first ? ` ${first}` : ""},\n\nHere's everything ${r.name}, your AI receptionist, currently knows about ${r.businessName}${waiting ? `, including ${waiting} item${waiting === 1 ? "" : "s"} waiting for your OK` : ""}. Could you take about 10 minutes to:\n\n- keep the suggestions that are right (one tap for all of them),\n- fix anything that's wrong and fill the few gaps,\n- add anything customers often ask?\n\n${url}\n\nEach change saves as you go, and there's no login. The link is private to you and works for 30 days.\n\nThanks,\n${by.email.split("@")[0]}\n${company}`,
        ...(mine.connected && by.sub ? { as: by.sub } : {}),
      });
      emailed = email;
    } catch (err) {
      problems.push(`the email didn't send (${(err as Error).message ?? err})`);
    }
  }
  if (to.phone && !phone) problems.push("that isn't a Canadian or US mobile number, so no text was sent");
  if (phone) {
    const { houseReceptionist } = await import("./house-line");
    const house = await houseReceptionist().catch(() => null);
    const stopped = house ? await db.smsOptOut.findUnique({ where: { receptionistId_phone: { receptionistId: house.id, phone } } }) : null;
    if (stopped) problems.push(`${phone} has opted out of our texts (replied STOP), so no text was sent`);
    else {
      try {
        const { sendSms } = await import("./twilio");
        await sendSms(phone, `Hi${first ? ` ${first}` : ""}, it's ${company}. Here's what ${r.name}, your AI receptionist, knows about ${r.businessName}${waiting ? ` (${waiting} item${waiting === 1 ? "" : "s"} need your OK)` : ""}. Tap to check, approve or add anything: ${url} (private link, no login, 30 days)`, house?.businessNumber ?? null);
        texted = phone;
      } catch (err) {
        problems.push(`the text didn't send (${(err as Error).message ?? err})`);
      }
    }
  }
  if (emailed || texted) {
    const { recordActivity } = await import("./outreach");
    await recordActivity({ accountId: r.accountId, type: texted && !emailed ? "SMS" : "EMAIL", direction: "OUTBOUND", source: "system", subject: "Knowledge base review link sent", body: `Sent to ${[emailed, texted].filter(Boolean).join(" and ")}: ${url}`, createdById: by.sub }).catch((e) => console.warn("review link activity", e));
  }
  return { url, emailed, texted, problems };
}
