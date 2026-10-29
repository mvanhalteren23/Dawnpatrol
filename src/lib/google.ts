import "server-only";
import { OAuth2Client } from "google-auth-library";
import { db } from "./db";
import { appUrl } from "./app-url";
import { getSetting, setSetting } from "./settings";
import { isSealed, open, openStored, seal } from "./secret-box";

// Two kinds of Google connection:
// - The company connection (CRM → Settings, admins): Drive folders and client receptionists'
//   calendars. Stored in Setting.
// - Each person's own connection (CRM → Settings → Your Gmail & Calendar): emails they send
//   from the CRM go from their Gmail, their mailbox is tracked, and their demo receptionists
//   book into their calendar. Stored in GoogleAccount (token encrypted).
// Every helper takes `as`: a user id for that person's connection, or nothing for the company.

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file", // only files/folders this app creates
  "https://www.googleapis.com/auth/gmail.readonly", // outreach tracking
  "https://www.googleapis.com/auth/gmail.send", // send tracked emails from the CRM
  "https://www.googleapis.com/auth/calendar.freebusy", // receptionist availability lookups
  "https://www.googleapis.com/auth/calendar.events", // receptionist bookings
  "openid",
  "email",
];

/** A person's own connection: no Drive (files stay in the company Drive). */
export const PERSONAL_SCOPES = GOOGLE_SCOPES.filter((s) => !s.includes("/drive"));

export type GoogleAs = string | null | undefined; // user id, or company

const REFRESH_KEY = "google.refresh_token";
const EMAIL_KEY = "google.email";
const SCOPES_KEY = "google.scopes";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function oauthClient(): OAuth2Client {
  if (!googleConfigured()) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured");
  return new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${appUrl()}/api/google/callback`,
  });
}

export function authUrl(state: string, kind: "company" | "personal" = "company", loginHint?: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    scope: kind === "company" ? GOOGLE_SCOPES : PERSONAL_SCOPES,
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
    // Point Google's account picker at the business Workspace (e.g. headabovedigital.com).
    ...(process.env.GOOGLE_WORKSPACE_DOMAIN ? { hd: process.env.GOOGLE_WORKSPACE_DOMAIN } : {}),
  });
}

/** Finish the Google sign-in: store the company connection, or this person's own. */
export async function completeOAuth(code: string, target: { kind: "company" } | { kind: "personal"; userId: string }): Promise<string | null> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  let email: string | null = null;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    email = ticket.getPayload()?.email?.toLowerCase() ?? null;
  }
  if (target.kind === "company") {
    // Switching the company account (e.g. a personal Gmail → the Workspace account): track the
    // new mailbox from two weeks back, and remember the old one so Settings can offer a Drive rebuild.
    const previous = await getSetting(EMAIL_KEY);
    if (email && previous && previous !== email) {
      await setSetting("google.previousEmail", previous);
      await setSetting("gmail.cursor", String(Math.floor(Date.now() / 1000) - 14 * 86400));
    }
    if (tokens.refresh_token) await setSetting(REFRESH_KEY, seal(tokens.refresh_token));
    if (tokens.scope) await setSetting(SCOPES_KEY, tokens.scope);
    if (email) await setSetting(EMAIL_KEY, email);
    return email;
  }
  if (!tokens.refresh_token) throw new Error("Google didn't grant offline access. Remove the app at myaccount.google.com/permissions and connect again.");
  if (!email) throw new Error("Google didn't share the account's email address");
  const data = { email, refreshToken: seal(tokens.refresh_token), scopes: tokens.scope ?? "", lastError: null };
  // Track this mailbox from now on (older mail was already synced by whoever had it before).
  await db.googleAccount.upsert({ where: { userId: target.userId }, create: { userId: target.userId, ...data, gmailCursor: Math.floor(Date.now() / 1000) - 14 * 86400 }, update: data });
  return email;
}

type Creds = { refresh: string; email: string | null; scopes: string; personal: boolean };

async function companyCreds(): Promise<Creds | null> {
  const [stored, email, scopes] = await Promise.all([getSetting(REFRESH_KEY), getSetting(EMAIL_KEY), getSetting(SCOPES_KEY)]);
  if (!stored) return null;
  // Connected before tokens were encrypted: encrypt it now.
  if (!isSealed(stored)) await setSetting(REFRESH_KEY, seal(stored));
  return { refresh: openStored(stored)!, email, scopes: scopes ?? "", personal: false };
}

/**
 * A person's credentials: their own connection, or the company connection when it is their own
 * Google account (e.g. the founder who connected it).
 */
async function personalCreds(userId: string): Promise<Creds | null> {
  const g = await db.googleAccount.findUnique({ where: { userId } });
  if (g) return { refresh: open(g.refreshToken), email: g.email, scopes: g.scopes, personal: true };
  const [user, company] = await Promise.all([db.user.findUnique({ where: { id: userId }, select: { email: true } }), companyCreds()]);
  return company && user && company.email && user.email.toLowerCase() === company.email.toLowerCase() ? company : null;
}

async function creds(as: GoogleAs): Promise<Creds | null> {
  return as ? personalCreds(as) : companyCreds();
}

export async function googleConnection(as?: GoogleAs): Promise<{ connected: boolean; email: string | null; calendar: boolean; personal: boolean }> {
  const c = googleConfigured() ? await creds(as).catch(() => null) : null;
  return { connected: Boolean(c), email: c?.email ?? null, calendar: Boolean(c?.scopes.includes("calendar.events")), personal: Boolean(c?.personal) };
}

export async function disconnectPersonal(userId: string) {
  await db.googleAccount.deleteMany({ where: { userId } });
}

export class GoogleApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Authenticated fetch against Google REST APIs, as a person (user id) or the company. */
export async function googleFetch<T = unknown>(url: string, init: RequestInit = {}, as?: GoogleAs): Promise<T> {
  const c = await creds(as);
  if (!c) throw new Error(as ? "Connect your Gmail & Calendar first (CRM → Settings)." : "Google is not connected. Connect it in CRM → Settings.");
  const client = oauthClient();
  client.setCredentials({ refresh_token: c.refresh });
  const { token } = await client.getAccessToken().catch((err: Error) => {
    if (c.personal && as) void db.googleAccount.updateMany({ where: { userId: as }, data: { lastError: `Google sign-in expired: ${err.message}` } });
    throw new Error(`Google sign-in for ${c.email ?? "this account"} has expired or was revoked. Reconnect it in CRM → Settings.`);
  });
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new GoogleApiError(res.status, `Google API ${res.status}: ${body.slice(0, 500)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function connectedEmail(as?: GoogleAs): Promise<string | null> {
  return (await creds(as))?.email ?? null;
}

/** Consumer Gmail addresses (not a business Workspace account). */
export function isConsumerGoogle(email: string | null | undefined): boolean {
  return /@(gmail|googlemail)\.com$/i.test(email ?? "");
}

/**
 * Support, admin and billing address (e.g. team@, an alias of the company account): client
 * reports, caller follow-ups and admin alerts go out from it. Sales outreach is sent from each
 * person's own account instead. Null = the company account itself.
 */
export async function companySendAs(): Promise<string | null> {
  return getSetting("google.sendAs");
}

/** Where support and admin notifications go: the support address, else the company account. */
export async function supportAddress(): Promise<string | null> {
  return (await companySendAs()) ?? (await connectedEmail());
}
