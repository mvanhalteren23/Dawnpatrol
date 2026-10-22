import "server-only";
import { OAuth2Client } from "google-auth-library";
import { getSetting, setSetting } from "./settings";

// One Google connection for the whole company (the founder's Google account). Works with
// personal @gmail.com accounts and Workspace alike. Connect from CRM → Settings.

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file", // only files/folders this app creates
  "https://www.googleapis.com/auth/gmail.readonly", // outreach tracking
  "https://www.googleapis.com/auth/gmail.send", // send tracked emails from the CRM
  "openid",
  "email",
];

const REFRESH_KEY = "google.refresh_token";
const EMAIL_KEY = "google.email";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function oauthClient(): OAuth2Client {
  if (!googleConfigured()) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured");
  return new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${process.env.APP_URL?.replace(/\/$/, "")}/api/google/callback`,
  });
}

export function authUrl(state: string): string {
  return oauthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: GOOGLE_SCOPES, state });
}

export async function completeOAuth(code: string): Promise<string | null> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (tokens.refresh_token) await setSetting(REFRESH_KEY, tokens.refresh_token);
  let email: string | null = null;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    email = ticket.getPayload()?.email ?? null;
    if (email) await setSetting(EMAIL_KEY, email.toLowerCase());
  }
  return email;
}

export async function googleConnection(): Promise<{ connected: boolean; email: string | null }> {
  const [token, email] = await Promise.all([getSetting(REFRESH_KEY), getSetting(EMAIL_KEY)]);
  return { connected: Boolean(token && googleConfigured()), email };
}

async function authedClient(): Promise<OAuth2Client> {
  const refresh = await getSetting(REFRESH_KEY);
  if (!refresh) throw new Error("Google is not connected. Connect it in CRM → Settings.");
  const client = oauthClient();
  client.setCredentials({ refresh_token: refresh });
  return client;
}

export class GoogleApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Authenticated fetch against Google REST APIs. */
export async function googleFetch<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const client = await authedClient();
  const { token } = await client.getAccessToken();
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

export async function connectedEmail(): Promise<string | null> {
  return getSetting(EMAIL_KEY);
}
