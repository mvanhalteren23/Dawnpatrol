import "server-only";
import { DEFAULT_REP_CAP_PERCENT, REP_CAP_KEY } from "./offer-rules";
import { getSetting } from "./settings";

/** The most a sales rep can discount without an admin (Billing → Special offers). */
export async function repDiscountCap(): Promise<number> {
  const raw = await getSetting(REP_CAP_KEY);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : DEFAULT_REP_CAP_PERCENT;
}
