import "server-only";
import { validateTwilioSignature } from "./twilio";
import { appUrl, twilioSignedUrls } from "./app-url";

export function appBase(): string {
  return appUrl();
}

/** Did Twilio sign this request? Checked against APP_URL and the host the request arrived on. */
export function twilioSignatureOk(req: Request, params: Record<string, string>, token: string): boolean {
  const url = new URL(req.url);
  const signature = req.headers.get("x-twilio-signature");
  return twilioSignedUrls(`${url.pathname}${url.search}`, req.headers.get("x-forwarded-host") ?? req.headers.get("host")).some((u) => validateTwilioSignature(token, u, params, signature));
}

export function xml(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

/**
 * Parse and authenticate a Twilio webhook. Twilio signs the public URL it called, so it's rebuilt
 * from APP_URL (or the host the request came in on) rather than the internal request URL.
 * Returns the form params, or a Response to send back as-is.
 */
export async function twilioParams(req: Request): Promise<Record<string, string> | Response> {
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return new Response("TWILIO_AUTH_TOKEN not set", { status: 500 });
  if (!twilioSignatureOk(req, params, token)) {
    return new Response("Invalid signature", { status: 403 });
  }
  return params;
}
