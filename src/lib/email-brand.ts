// Branded emails to a client's callers, a calendar file they can add, and the client's logo and
// colour from their website (pure; unit tested).

export type Brand = { businessName: string; logoUrl?: string | null; color?: string | null; signOff?: string | null };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A colour we'll put in an email: #rgb or #rrggbb only. */
export function safeColor(c: string | null | undefined, fallback = "#1F3B2D"): string {
  const v = (c ?? "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback;
}

/** A logo address we'll put in an email: https only. */
export function safeLogo(u: string | null | undefined): string | null {
  const v = (u ?? "").trim();
  try {
    const url = new URL(v);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Readable text colour on a background colour. */
function onColor(hex: string): string {
  const h = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (0.299 * r! + 0.587 * g! + 0.114 * b!) / 255 > 0.6 ? "#1F1F1F" : "#FFFFFF";
}

/** The plain-text body, laid out in the client's brand (paragraphs from blank lines, links kept as text). */
export function brandedHtml(brand: Brand, body: string): string {
  const color = safeColor(brand.color);
  const logo = safeLogo(brand.logoUrl);
  const paragraphs = body.trim().split(/\n\s*\n/).map((p) => `<p style="margin:0 0 14px;line-height:1.5">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const header = logo
    ? `<img src="${esc(logo)}" alt="${esc(brand.businessName)}" style="max-height:56px;max-width:220px;display:block">`
    : `<div style="font-size:20px;font-weight:700;color:${onColor(color)}">${esc(brand.businessName)}</div>`;
  const sign = brand.signOff?.trim() ? `<p style="margin:14px 0 0;line-height:1.5">${esc(brand.signOff.trim()).replace(/\n/g, "<br>")}</p>` : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:${logo ? "#ffffff" : color};padding:20px 24px;border-bottom:4px solid ${color}">${header}</td></tr>
<tr><td style="padding:24px;font-size:15px">${paragraphs}${sign}</td></tr>
</table></td></tr></table></body></html>`;
}

// --- Calendar file (.ics) -------------------------------------------------------------

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Fold lines at 75 octets (RFC 5545). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

export type IcsEvent = { uid: string; start: Date; end: Date; title: string; description?: string; location?: string; status?: "CONFIRMED" | "CANCELLED" };

/** One event the customer can add to any calendar (PUBLISH: no organizer, so no "invitation from" warnings). */
export function icsFile(events: IcsEvent[], o: { name: string; method?: "PUBLISH" } = { name: "Booking" }, now = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Head Above Digital//Bookings//EN", "CALSCALE:GREGORIAN", `METHOD:${o.method ?? "PUBLISH"}`, `X-WR-CALNAME:${icsText(o.name)}`];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${icsTime(now)}`,
      `DTSTART:${icsTime(e.start)}`,
      `DTEND:${icsTime(e.end)}`,
      `SUMMARY:${icsText(e.title)}`,
      ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
      ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
      `STATUS:${e.status ?? "CONFIRMED"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// --- Email with HTML and attachments (MIME) ---------------------------------------------

export type Attachment = { filename: string; contentType: string; content: string };

/** The body part of a MIME message: text + HTML alternatives, plus attachments. Returns [headers, body]. */
export function mimeBody(o: { text: string; html?: string | null; attachments?: Attachment[] }, boundarySeed = Math.random().toString(36).slice(2)): { contentType: string; body: string } {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const textPart = ['Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64(o.text)].join("\r\n");
  if (!o.html && !o.attachments?.length) return { contentType: 'text/plain; charset="UTF-8"', body: o.text };
  const alt = `alt_${boundarySeed}`;
  const alternative = o.html
    ? [`--${alt}`, textPart, `--${alt}`, ['Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64(o.html)].join("\r\n"), `--${alt}--`].join("\r\n")
    : null;
  if (!o.attachments?.length) return { contentType: `multipart/alternative; boundary="${alt}"`, body: alternative! };
  const mixed = `mix_${boundarySeed}`;
  const parts = [
    alternative ? [`Content-Type: multipart/alternative; boundary="${alt}"`, "", alternative].join("\r\n") : textPart,
    ...o.attachments.map((a) => [`Content-Type: ${a.contentType}; name="${a.filename.replace(/"/g, "")}"`, `Content-Disposition: attachment; filename="${a.filename.replace(/"/g, "")}"`, "Content-Transfer-Encoding: base64", "", b64(a.content)].join("\r\n")),
  ];
  return { contentType: `multipart/mixed; boundary="${mixed}"`, body: [...parts.map((p) => `--${mixed}\r\n${p}`), `--${mixed}--`].join("\r\n") };
}

// --- Logo and colour from the client's website --------------------------------------------

/** The logo and brand colour a website declares (apple-touch-icon / logo image / og:image; theme-color). */
export function brandFromHtml(html: string, pageUrl: string): { logoUrl: string | null; color: string | null } {
  const head = html.slice(0, 200_000);
  const abs = (href: string | undefined) => {
    if (!href) return null;
    try {
      const u = new URL(href.replace(/&amp;/g, "&"), pageUrl);
      return u.protocol === "https:" ? u.toString() : null;
    } catch {
      return null;
    }
  };
  const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
  const tags = (re: RegExp) => head.match(re) ?? [];
  const links = tags(/<link\b[^>]*>/gi);
  const metas = tags(/<meta\b[^>]*>/gi);
  const imgs = tags(/<img\b[^>]*>/gi);

  const logoImg = imgs.find((t) => /logo/i.test(`${attr(t, "class") ?? ""} ${attr(t, "id") ?? ""} ${attr(t, "alt") ?? ""} ${attr(t, "src") ?? ""}`) && !/\.svg(\?|$)/i.test(attr(t, "src") ?? ""));
  const touch = links.find((t) => /apple-touch-icon/i.test(attr(t, "rel") ?? ""));
  const og = metas.find((t) => /og:image$/i.test(attr(t, "property") ?? attr(t, "name") ?? ""));
  const logoUrl = abs(attr(logoImg ?? "", "src")) ?? abs(attr(touch ?? "", "href")) ?? abs(attr(og ?? "", "content"));

  const theme = metas.find((t) => /^(theme-color|msapplication-TileColor)$/i.test(attr(t, "name") ?? ""));
  const color = attr(theme ?? "", "content")?.trim() ?? null;
  return { logoUrl, color: color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : null };
}
