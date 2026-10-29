// The app's public address, from APP_URL (pure; unit tested). Tolerates the usual slips when the
// variable is edited by hand: spaces, a trailing slash or comma, or two addresses pasted in.

/** The first valid http(s) address in the text, without a trailing slash; "" if there's none. */
export function cleanAppUrl(raw: string | null | undefined): string {
  for (const part of (raw ?? "").split(/[\s,;]+/)) {
    try {
      const u = new URL(part);
      if (u.protocol === "https:" || u.protocol === "http:") return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
    } catch {
      // not an address; try the next part
    }
  }
  return "";
}

export function appUrl(): string {
  return cleanAppUrl(process.env.APP_URL);
}

/** True when APP_URL had to be cleaned up (shown as a warning in Settings). */
export function appUrlNeedsFixing(): boolean {
  const raw = (process.env.APP_URL ?? "").trim();
  return Boolean(raw) && raw.replace(/\/+$/, "") !== appUrl();
}

/**
 * Addresses a Twilio webhook may have been signed with: the configured APP_URL, and the host the
 * request actually came in on (so changing APP_URL or adding a domain doesn't break live calls
 * whose Twilio numbers still point at the old address).
 */
export function twilioSignedUrls(pathAndQuery: string, forwardedHost: string | null, base = appUrl()): string[] {
  const hosts = [base, forwardedHost && /^[a-z0-9.-]+(:\d+)?$/i.test(forwardedHost) ? `https://${forwardedHost}` : ""].filter(Boolean);
  return [...new Set(hosts.map((h) => `${h}${pathAndQuery}`))];
}
