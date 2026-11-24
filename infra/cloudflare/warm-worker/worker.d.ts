// Types for worker.js (plain JavaScript so it pastes straight into the Cloudflare editor).
export type WarmEnv = { WARM_URL?: string; WARM_TZ?: string; WARM_START_HOUR?: string; WARM_END_HOUR?: string; WARM_DAYS?: string; WARM_TOKEN?: string };
export function inWarmHours(now: Date, env: WarmEnv): boolean;
declare const worker: { scheduled(event: unknown, env: WarmEnv, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> };
export default worker;
