import "server-only";
import { validateTwilioSignature } from "./twilio";

export function appBase(): string {
  return (process.env.APP_URL ?? "").replace(/\/$/, "");
}

export function xml(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

/**
 * Parse and authenticate a Twilio webhook. Twilio signs the public URL it called, so the URL is
 * rebuilt from APP_URL rather than the internal request URL. Returns the form params, or a
 * Response to send back as-is.
 */
export async function twilioParams(req: Request): Promise<Record<string, string> | Response> {
  const url = new URL(req.url);
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return new Response("TWILIO_AUTH_TOKEN not set", { status: 500 });
  if (!validateTwilioSignature(token, `${appBase()}${url.pathname}${url.search}`, params, req.headers.get("x-twilio-signature"))) {
    return new Response("Invalid signature", { status: 403 });
  }
  return params;
}
