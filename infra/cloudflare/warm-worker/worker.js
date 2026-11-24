// Cloudflare Worker (cron): pings the CRM's warm-up route every 4 minutes during business hours,
// so calls don't wait for a cold server or a sleeping database. Free on Cloudflare's Workers plan.
// Set up: see docs/warm-ping.md.

const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Is it within the warm hours, in the configured time zone? */
export function inWarmHours(now, env) {
  const tz = env.WARM_TZ || "America/Vancouver";
  const start = Number(env.WARM_START_HOUR ?? 7);
  const end = Number(env.WARM_END_HOUR ?? 19);
  const days = (env.WARM_DAYS || "1,2,3,4,5,6").split(",").map(Number);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  return days.includes(DAYS[parts.weekday]) && hour >= start && hour < end;
}

export default {
  async scheduled(_event, env, ctx) {
    if (!inWarmHours(new Date(), env)) return;
    const url = `${env.WARM_URL || "https://headabovedigital.com"}/api/health/warm`;
    ctx.waitUntil(
      fetch(url, { headers: env.WARM_TOKEN ? { "x-warm": env.WARM_TOKEN } : {} }).catch(() => undefined),
    );
  },
};
