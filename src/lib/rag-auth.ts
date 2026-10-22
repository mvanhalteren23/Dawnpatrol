import "server-only";
import { timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { apiSession } from "./auth";
import { canAccessReceptionist } from "./access";

/** RAG endpoints accept the receptionist's bearer token (ElevenLabs tools, scripts) or a logged-in session. */
export async function authorizeRag(req: Request, receptionistId: string) {
  const r = await db.receptionist.findUnique({ where: { id: receptionistId }, include: { knowledge: true } });
  if (!r) return null;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (bearer) {
    const a = Buffer.from(bearer);
    const b = Buffer.from(r.ragToken);
    return a.length === b.length && timingSafeEqual(a, b) ? r : null;
  }
  return (await canAccessReceptionist(await apiSession(), receptionistId)) ? r : null;
}
