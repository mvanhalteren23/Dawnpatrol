// Passkey helpers (pure; unit tested).

/**
 * The relying party for passkeys: the site's own domain without "www", so a passkey made on
 * headabovedigital.com also works on www.headabovedigital.com (and in the Android app, which
 * runs on the same origin).
 */
export function rpFor(appUrl: string): { rpID: string; origins: string[] } {
  const u = new URL(appUrl);
  const host = u.hostname.replace(/^www\./, "");
  const port = u.port ? `:${u.port}` : "";
  const origins = [`${u.protocol}//${host}${port}`];
  if (host !== "localhost" && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) origins.push(`${u.protocol}//www.${host}${port}`);
  return { rpID: host, origins };
}

/** A friendly name for a new passkey, from the browser that made it. */
export function passkeyName(userAgent: string): string {
  const ua = userAgent || "";
  const pixel = ua.match(/Pixel [0-9][0-9a-zA-Z ]*?(?=[;)])/);
  if (pixel) return pixel[0].trim();
  if (/Android/i.test(ua)) return "Android phone";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows computer";
  if (/CrOS/i.test(ua)) return "Chromebook";
  return "Passkey";
}
