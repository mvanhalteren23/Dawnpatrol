import { createHmac, timingSafeEqual } from "node:crypto";

// Outbound emails sent from the CRM get an open pixel and signed click-through links.
// Links are signed so the redirect endpoint can't be abused as an open redirect.

function key(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

export function signLink(activityId: string, url: string): string {
  return createHmac("sha256", key()).update(`${activityId}|${url}`).digest("base64url").slice(0, 32);
}

export function verifyLink(activityId: string, url: string, sig: string): boolean {
  const expected = Buffer.from(signLink(activityId, url));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function instrumentHtml(html: string, activityId: string, appUrl: string): string {
  const base = appUrl.replace(/\/$/, "");
  const withLinks = html.replace(/href="(https?:\/\/[^"]+)"/g, (_m, url: string) => {
    const tracked = `${base}/api/track/click/${activityId}?u=${encodeURIComponent(url)}&s=${signLink(activityId, url)}`;
    return `href="${tracked}"`;
  });
  return `${withLinks}<img src="${base}/api/track/open/${activityId}" width="1" height="1" alt="" style="display:none" />`;
}

/** Plain-text body -> minimal HTML with auto-linked URLs. */
export function textToHtml(text: string): string {
  // Quotes too: a URL containing " must not break out of the href attribute.
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const linked = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${linked.split(/\n/).join("<br>")}</div>`;
}
