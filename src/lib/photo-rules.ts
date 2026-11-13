// Photos customers text to a line (MMS), pure parts (unit tested).

export const MAX_PHOTOS_PER_TEXT = 5;
export const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024; // carriers cap MMS well below this
export const MAX_STORED_BYTES = 3 * 1024 * 1024; // stored as-is only up to this, otherwise re-compressed
export const MAX_PHOTOS_PER_CUSTOMER_DAY = 20;
export const MAX_PHOTOS_PER_LINE_DAY = 150;
export const PHOTO_RETENTION_DAYS = 60;
export const PHOTO_LINK_DAYS = 30;

/** Raster images only: SVG and anything else could carry script when opened. */
const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

export function isPhotoType(type: string | null | undefined): boolean {
  return IMAGE_TYPES.has((type ?? "").toLowerCase().split(";")[0]!.trim());
}

export type MediaRef = { url: string; type: string };

/** The photos in a Twilio inbound text (NumMedia, MediaUrl0…, MediaContentType0…). Only Twilio's own media addresses. */
export function parseMedia(params: Record<string, string>): MediaRef[] {
  const n = Math.min(Number(params.NumMedia) || 0, 10);
  const out: MediaRef[] = [];
  for (let i = 0; i < n && out.length < MAX_PHOTOS_PER_TEXT; i++) {
    const url = params[`MediaUrl${i}`] ?? "";
    const type = (params[`MediaContentType${i}`] ?? "").toLowerCase().split(";")[0]!.trim();
    if (isPhotoType(type) && /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/AC[0-9a-f]{32}\/Messages\/MM[0-9a-f]{32}\/Media\/ME[0-9a-f]{32}$/i.test(url)) out.push({ url, type });
  }
  return out;
}

/** What to say back to a customer who texted photos (with no words, nothing else answers). */
export function photoAck(n: number): string {
  return `Thanks, we got your photo${n === 1 ? "" : "s"}. We've passed ${n === 1 ? "it" : "them"} on and will be in touch soon.`;
}

/** The text the owner gets. */
export function photoAlertText(o: { business: string; who: string; n: number; caption: string; link: string }): string {
  const cap = o.caption.trim() ? ` "${o.caption.trim().slice(0, 160)}"` : "";
  return `${o.business}: ${o.who} sent ${o.n} photo${o.n === 1 ? "" : "s"}.${cap} View: ${o.link}`;
}

/** Whether a customer or the line has sent too many photos today. */
export function photoOverLimit(o: { customerToday: number; lineToday: number; incoming: number }): "customer" | "line" | null {
  if (o.customerToday + o.incoming > MAX_PHOTOS_PER_CUSTOMER_DAY) return "customer";
  if (o.lineToday + o.incoming > MAX_PHOTOS_PER_LINE_DAY) return "line";
  return null;
}

/** The text of the message as the text agent should see it when photos came with it. */
export function bodyWithPhotos(body: string, n: number): string {
  const note = `[The customer also sent ${n} photo${n === 1 ? "" : "s"}, which the team can see.]`;
  return body.trim() ? `${body.trim()}\n${note}` : note;
}
