// The time before a caller hears the agent: rules for keeping the answer webhook fast.
// Required lookups (which line, call protections) always run; optional context (caller memory,
// returning-prospect details) runs in parallel and is dropped if it isn't ready in time.

/** How long optional context may take before the agent answers without it. */
export const ANSWER_BUDGET_MS = 700;

/**
 * Grace's caller context (team member, prospect with a demo, client) gets longer: recognising a
 * prospect is worth a moment more, but never an open-ended wait.
 */
export const GRACE_CONTEXT_BUDGET_MS = 1500;

/** What Grace is told when the caller couldn't be looked up in time: a new caller, her usual greeting. */
export function plainCallerContext(greeting: string) {
  return { caller_type: "new" as const, team_name: "", caller_first_name: "", demo_business: "", demo_extension: "", demo_return: "", opening: greeting };
}

/** How long a receptionist looked up by its number is reused within one server instance. */
export const LINE_CACHE_MS = 30_000;

/** `p`, or `fallback` if it fails or isn't ready within `ms`. Never throws. */
export function withBudget<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([p.catch(() => fallback), late]).finally(() => clearTimeout(timer));
}

/** A small per-instance cache with expiry (for lookups on the answer path). */
export class TtlCache<V> {
  private entries = new Map<string, { value: V; at: number }>();
  constructor(private ttlMs: number, private max = 500) {}

  get(key: string, now = Date.now()): V | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (now - e.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: V, now = Date.now()): void {
    if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(key, { value, at: now });
  }

  clear(): void {
    this.entries.clear();
  }

  /** The cached value, or load it (a failed load isn't cached). */
  async getOrLoad(key: string, load: () => Promise<V>, now = Date.now()): Promise<V> {
    const hit = this.get(key, now);
    if (hit !== undefined) return hit;
    const value = await load();
    if (value !== undefined && value !== null) this.set(key, value, now);
    return value;
  }
}
