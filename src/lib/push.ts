import "server-only";
import webpush from "web-push";
import { db } from "./db";
import { getSetting, setSetting } from "./settings";
import { open, seal } from "./secret-box";
import { clip, parsePrefs, safeCrmPath, shouldNotify, type PushCategory } from "./push-rules";

// Phone notifications (Web Push). Works in Chrome on Android, inside the Head Above Android app,
// and on desktop browsers. The VAPID keys are made once and kept in the database (the private
// key encrypted), so there's nothing to set up in Vercel.

const KEY_SETTING = "push.vapid";

type Keys = { publicKey: string; privateKey: string };
let cached: Keys | null = null;

export async function vapidKeys(): Promise<Keys> {
  if (cached) return cached;
  const stored = await getSetting(KEY_SETTING);
  if (stored) {
    const j = JSON.parse(stored) as { publicKey: string; privateKey: string };
    cached = { publicKey: j.publicKey, privateKey: open(j.privateKey) };
    return cached;
  }
  const made = webpush.generateVAPIDKeys();
  await setSetting(KEY_SETTING, JSON.stringify({ publicKey: made.publicKey, privateKey: seal(made.privateKey) }));
  // Two first requests at once could both make keys: re-read so everyone uses the one saved last.
  const again = JSON.parse((await getSetting(KEY_SETTING))!) as { publicKey: string; privateKey: string };
  cached = { publicKey: again.publicKey, privateKey: open(again.privateKey) };
  return cached;
}

export type PushMessage = {
  category: PushCategory;
  title: string;
  body: string;
  url?: string | null; // a CRM path to open when tapped
  urgent?: boolean; // breaks through quiet hours (if the user allows it)
  tag?: string; // replaces an earlier notification with the same tag
};

/** Send to these users' devices, honouring each user's categories and quiet hours. */
export async function pushToUsers(userIds: string[], msg: PushMessage, now = new Date(), opts: { ignorePrefs?: boolean } = {}): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return 0;
  const users = await db.user.findMany({
    where: { id: { in: ids }, disabled: false, role: { in: ["ADMIN", "REP"] } },
    select: { id: true, pushPrefs: true, pushSubscriptions: true },
  });
  const targets = users.filter((u) => u.pushSubscriptions.length && (opts.ignorePrefs || shouldNotify(parsePrefs(u.pushPrefs), msg.category, Boolean(msg.urgent), now)));
  if (!targets.length) return 0;
  const keys = await vapidKeys();
  const { appUrl } = await import("./app-url");
  const payload = JSON.stringify({
    title: clip(msg.title, 80),
    body: clip(msg.body, 240),
    url: safeCrmPath(msg.url),
    tag: msg.tag ?? `${msg.category}:${clip(msg.title, 40)}`,
    urgent: Boolean(msg.urgent),
  });
  let sent = 0;
  for (const u of targets) {
    for (const s of u.pushSubscriptions) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          vapidDetails: { subject: appUrl(), publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: msg.urgent ? 6 * 3600 : 24 * 3600,
          urgency: msg.urgent ? "high" : "normal",
          timeout: 5000,
        });
        sent++;
        await db.pushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: new Date() } }).catch(() => undefined);
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        // Gone: the app was uninstalled or notifications were turned off on that device.
        if (code === 404 || code === 410) await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        else console.warn("push failed", code ?? (err as Error).message);
      }
    }
  }
  return sent;
}

/** Everyone on the team who should hear about the platform: administrators. */
export async function pushToAdmins(msg: PushMessage): Promise<number> {
  const admins = await db.user.findMany({ where: { role: "ADMIN", disabled: false }, select: { id: true } });
  return pushToUsers(admins.map((a) => a.id), msg);
}

/** An account's owner (rep) plus the administrators; never throws (alerts mustn't break the caller). */
export async function pushForAccount(accountId: string, msg: PushMessage): Promise<number> {
  try {
    const [account, admins] = await Promise.all([
      db.account.findUnique({ where: { id: accountId }, select: { ownerId: true } }),
      db.user.findMany({ where: { role: "ADMIN", disabled: false }, select: { id: true } }),
    ]);
    return await pushToUsers([...(account?.ownerId ? [account.ownerId] : []), ...admins.map((a) => a.id)], { url: `/crm/accounts/${accountId}`, ...msg });
  } catch (err) {
    console.warn("push for account failed", err);
    return 0;
  }
}
