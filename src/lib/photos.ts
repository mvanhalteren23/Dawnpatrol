import "server-only";
import type { Receptionist } from "@prisma/client";
import { db } from "./db";
import { appUrl } from "./app-url";
import { toE164, twilioApi } from "./twilio";
import { alertOwner } from "./customer-texts";
import { cleanFirstName } from "./caller-memory-rules";
import { photoToken } from "./photo-token";
import { MAX_DOWNLOAD_BYTES, MAX_STORED_BYTES, PHOTO_RETENTION_DAYS, isPhotoType, photoAck, photoAlertText, photoOverLimit, type MediaRef } from "./photo-rules";

// Photos customers text to a client's line (MMS): stored here (not left at Twilio), sent to the
// owner as a link to view them, kept 60 days. See photo-rules.ts for limits and wording.

type R = Receptionist;

export type AcceptedPhotos = { count: number; background: () => Promise<void> };

/**
 * A customer's text came with photos. Returns null when it's over the daily limit (the text is
 * handled without them); otherwise the photos to save in the background once the reply is sent.
 */
export async function acceptPhotos(r: R, fromRaw: string, body: string, media: MediaRef[], messageSid: string): Promise<AcceptedPhotos | null> {
  const from = toE164(fromRaw);
  if (!from || !/^MM[0-9a-f]{32}$/i.test(messageSid) || !media.length) return null;
  const since = new Date(Date.now() - 24 * 3600_000);
  const [customerToday, lineToday] = await Promise.all([
    db.smsMedia.count({ where: { receptionistId: r.id, phone: from, createdAt: { gte: since } } }),
    db.smsMedia.count({ where: { receptionistId: r.id, createdAt: { gte: since } } }),
  ]);
  if (photoOverLimit({ customerToday, lineToday, incoming: media.length })) return null;

  // Photos with no words: log them as a text, and the reply is the thank-you (nothing else would answer).
  if (!body.trim()) await db.smsMessage.create({ data: { receptionistId: r.id, phone: from, direction: "IN", kind: "photo", body: `[${media.length} photo${media.length === 1 ? "" : "s"}]` } });
  return { count: media.length, background: () => savePhotos(r, from, body, media, messageSid) };
}

/** The thank-you for photos sent without words, logged with the line's texts. */
export async function logPhotoAck(r: R, from: string, count: number): Promise<string> {
  const text = photoAck(count);
  await db.smsMessage.create({ data: { receptionistId: r.id, phone: toE164(from), direction: "OUT", kind: "photo", body: text } });
  return text;
}

async function download(m: MediaRef): Promise<{ data: Buffer; type: string } | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  try {
    const res = await fetch(m.url, { headers: sid && token ? { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` } : {}, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_DOWNLOAD_BYTES) return null;
    const data = Buffer.from(await res.arrayBuffer());
    const type = (res.headers.get("content-type") ?? m.type).split(";")[0]!.trim().toLowerCase();
    return data.length <= MAX_DOWNLOAD_BYTES && isPhotoType(type) ? { data, type } : null;
  } catch (err) {
    console.warn("photo download failed", err);
    return null;
  }
}

/** Phones save big photos: shrink to 1600px JPEG. If that isn't possible, keep it only if it's small. */
async function shrink(photo: { data: Buffer; type: string }): Promise<{ data: Buffer; type: string } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const data = await sharp(photo.data, { failOn: "none" }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
    return { data, type: "image/jpeg" };
  } catch {
    return photo.data.length <= MAX_STORED_BYTES ? photo : null;
  }
}

async function savePhotos(r: R, phone: string, caption: string, media: MediaRef[], messageSid: string) {
  let stored = 0;
  for (const m of media) {
    const got = await download(m);
    const small = got ? await shrink(got) : null;
    if (!small) continue;
    await db.smsMedia.create({ data: { receptionistId: r.id, messageSid, phone, caption: caption.trim().slice(0, 300), contentType: small.type, data: new Uint8Array(small.data), bytes: small.data.length } });
    stored++;
    // Once it's saved here, delete it at Twilio (the photo isn't kept in two places).
    const ids = /\/Messages\/(MM[0-9a-f]{32})\/Media\/(ME[0-9a-f]{32})$/i.exec(m.url);
    if (ids) await twilioApi(`/Messages/${ids[1]}/Media/${ids[2]}.json`, { method: "DELETE" }).catch((e) => console.warn("photo delete at Twilio", e));
  }
  const who = await customerLabel(r.id, phone);
  if (!stored) {
    await alertOwner(r, `${r.businessName}: ${who} texted ${media.length} photo${media.length === 1 ? "" : "s"} that couldn't be saved. Reply to them or ask them to send again.`);
    return;
  }
  await alertOwner(r, photoAlertText({ business: r.businessName, who, n: stored, caption, link: `${appUrl()}/p/${photoToken(messageSid)}` }));
}

/** "Dave" if we know the customer's first name from a booking, otherwise their number. */
async function customerLabel(receptionistId: string, phone: string): Promise<string> {
  const known = await db.booking.findFirst({ where: { receptionistId, customerPhone: phone }, orderBy: { createdAt: "desc" }, select: { customerName: true } });
  const first = cleanFirstName(known?.customerName);
  return first ? `${first} (${phone})` : phone;
}

/** Daily: photos older than the retention period are deleted. */
export async function expireOldPhotos(): Promise<number> {
  const res = await db.smsMedia.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - PHOTO_RETENTION_DAYS * 86_400_000) } } });
  return res.count;
}
