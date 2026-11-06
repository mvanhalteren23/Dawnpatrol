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
