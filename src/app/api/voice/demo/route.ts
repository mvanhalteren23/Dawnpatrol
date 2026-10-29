import { after } from "next/server";
import { db } from "@/lib/db";
import { demoLineConfig } from "@/lib/demo-line";
import { registerTwilioCall } from "@/lib/elevenlabs";
import { recordActivity } from "@/lib/outreach";
import { cleanDigits, gatherExtension, samePhone, say, twiml } from "@/lib/twilio";
import { appUrl } from "@/lib/app-url";
import { twilioSignatureOk } from "@/lib/twilio-request";

// Demo line directory. Twilio's Voice webhook for the demo number points here:
//   1. Greet and <Gather> an extension.
//   2. Look up the demo receptionist with that extension and hand the call to its ElevenLabs agent.
//   3. Log the call on the prospect's account (a strong buying signal).

const MAX_ATTEMPTS = 3;

function xml(body: string) {
  return new Response(body, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

function base() {
  return appUrl();
}

async function connect(agentId: string, from: string, to: string) {
  try {
    return xml(await registerTwilioCall(agentId, from, to));
  } catch (err) {
    console.error("demo line: register-call failed", err);
    return xml(twiml(`${say("Sorry, the demo is having a technical issue. Please try again in a few minutes.")}<Hangup/>`));
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));

  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return new Response("TWILIO_AUTH_TOKEN not set", { status: 500 });
  // Twilio signs the public URL it called: APP_URL, or the host the call came in on.
  if (!twilioSignatureOk(req, params, token)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const config = await demoLineConfig();
  const from = params.From ?? "";
  const to = params.To ?? config.number;
  const attempt = Number(url.searchParams.get("attempt") ?? 0);
  const action = (n: number) => `${base()}/api/voice/demo?step=ext&attempt=${n}`;

  // First hit: greet and ask for the extension.
  if (url.searchParams.get("step") !== "ext") {
    return xml(gatherExtension(config.greeting, action(1), action(1)));
  }

  const digits = cleanDigits(params.Digits);
  const receptionist = digits
    ? await db.receptionist.findUnique({ where: { demoExtension: digits }, include: { account: { include: { contacts: true } } } })
    : null;

  if (receptionist?.elevenLabsAgentId) {
    const account = receptionist.account;
    after(async () => {
      const contact = account.contacts.find((c) => samePhone(c.phone, from));
      await recordActivity({
        accountId: account.id,
        contactId: contact?.id ?? null,
        type: "CALL",
        direction: "INBOUND",
        subject: `Called the demo line (ext ${digits})`,
        body: `Caller ${from || "unknown"} reached the ${receptionist.name} demo. Transcript and outcome appear under the receptionist's calls.`,
        source: "demo-line",
        externalId: params.CallSid ? `twilio:${params.CallSid}` : null,
      }).catch((e) => console.warn("demo line activity", e));
    });
    return connect(receptionist.elevenLabsAgentId, from, to);
  }

  if (attempt >= MAX_ATTEMPTS) {
    const fallback = config.fallbackReceptionistId
      ? await db.receptionist.findUnique({ where: { id: config.fallbackReceptionistId } })
      : null;
    if (fallback?.elevenLabsAgentId) return connect(fallback.elevenLabsAgentId, from, to);
    return xml(twiml(`${say("Sorry, we couldn't find that demo. Please check the extension in your email and call back. Goodbye.")}<Hangup/>`));
  }

  const retry = !digits
    ? "Sorry, I didn't catch that. Please enter your demo extension, then press pound."
    : receptionist
      ? "That demo isn't ready yet. Please try another extension, or call back later."
      : "That extension isn't set up. Please enter your demo extension again, then press pound.";
  return xml(gatherExtension(retry, action(attempt + 1), action(attempt + 1)));
}
