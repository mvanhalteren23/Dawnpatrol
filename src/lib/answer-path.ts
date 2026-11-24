import "server-only";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { LINE_CACHE_MS, TtlCache } from "./answer-path-rules";

// Lookups on the answer path, cached briefly per server instance so a busy line (or a warm-up ping)
// doesn't wait on the database for every call. Changes made in the CRM clear this instance's
// cache; other instances pick them up within LINE_CACHE_MS.

const lines = new TtlCache<Receptionist>(LINE_CACHE_MS);

export async function receptionistByNumber(number: string): Promise<Receptionist | null> {
  if (!number) return null;
  return lines.getOrLoad(`n:${number}`, () => db.receptionist.findUnique({ where: { businessNumber: number } }) as Promise<Receptionist>);
}

/** Grace, the company's own receptionist (cached). */
export async function cachedHouseReceptionist(): Promise<Receptionist | null> {
  const { houseReceptionist } = await import("./house-line");
  return lines.getOrLoad("house", () => houseReceptionist() as Promise<Receptionist>);
}

export function clearLineCache(): void {
  lines.clear();
}
