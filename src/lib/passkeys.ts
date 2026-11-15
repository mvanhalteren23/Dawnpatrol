import "server-only";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, AuthenticatorTransport, RegistrationResponseJSON } from "@simplewebauthn/server";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "./db";
import { appUrl } from "./app-url";
import { passkeyName, rpFor } from "./passkey-rules";

// Passkeys: sign in with the phone's fingerprint, face or screen lock (WebAuthn). A passkey proves
// both "something you have" (the phone) and "something you are/know" (the unlock), so it stands in
// for the password and the two-step code together.

const CHALLENGE_COOKIE = "dp_pk";
const CHALLENGE_SECONDS = 5 * 60;

function key(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET must be set (16+ characters)");
  return new TextEncoder().encode(secret);
}

/** The relying party (the site) passkeys belong to: headabovedigital.com, also used from www. */
function rp() {
  return rpFor(appUrl());
}

async function saveChallenge(challenge: string, purpose: "register" | "login", userId = "") {
  const token = await new SignJWT({ challenge, purpose }).setProtectedHeader({ alg: "HS256" }).setSubject(userId || "-").setIssuedAt().setExpirationTime(`${CHALLENGE_SECONDS}s`).sign(key());
  (await cookies()).set(CHALLENGE_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: CHALLENGE_SECONDS });
}

/** The challenge we issued (single use: the cookie is cleared as it's read). */
async function takeChallenge(purpose: "register" | "login", userId = ""): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(CHALLENGE_COOKIE)?.value;
  store.delete(CHALLENGE_COOKIE);
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, key());
    if (payload.purpose !== purpose || typeof payload.challenge !== "string") return null;
    if (purpose === "register" && payload.sub !== userId) return null;
    return payload.challenge;
  } catch {
    return null;
  }
}

const transportsOf = (s: string) => s.split(",").filter(Boolean) as AuthenticatorTransport[];

export async function registrationOptions(user: { id: string; email: string; name: string | null }) {
  const { rpID } = rp();
  const existing = await db.passkey.findMany({ where: { userId: user.id }, select: { credentialId: true, transports: true } });
  const options = await generateRegistrationOptions({
    rpName: "Head Above",
    rpID,
    userName: user.email,
    userDisplayName: user.name || user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: transportsOf(c.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await saveChallenge(options.challenge, "register", user.id);
  return options;
}

export async function finishRegistration(userId: string, response: RegistrationResponseJSON, userAgent: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const expectedChallenge = await takeChallenge("register", userId);
  if (!expectedChallenge) return { ok: false, error: "That took too long. Try again." };
  const { rpID, origins } = rp();
  try {
    const v = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true });
    if (!v.verified || !v.registrationInfo) return { ok: false, error: "The passkey couldn't be verified." };
    const c = v.registrationInfo.credential;
    const name = passkeyName(userAgent);
    await db.passkey.create({ data: { userId, credentialId: c.id, publicKey: new Uint8Array(c.publicKey), counter: c.counter, transports: (c.transports ?? []).join(","), name } });
    return { ok: true, name };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function loginOptions() {
  const { rpID } = rp();
  // No list of credentials: the phone offers the passkeys it has for this site (no email needed).
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  await saveChallenge(options.challenge, "login");
  return options;
}

export type PasskeyUser = { id: string; email: string; role: string; accountId: string | null };

export async function finishLogin(response: AuthenticationResponseJSON): Promise<{ ok: true; user: PasskeyUser } | { ok: false; error: string }> {
  const expectedChallenge = await takeChallenge("login");
  if (!expectedChallenge) return { ok: false, error: "That took too long. Try again." };
  const pk = await db.passkey.findUnique({ where: { credentialId: response.id }, include: { user: { select: { id: true, email: true, role: true, accountId: true, disabled: true, lockedUntil: true } } } });
  // The same answer whether the passkey is unknown or its login is off, so it can't be probed.
  const refused = { ok: false as const, error: "That passkey isn't set up for a login here. Sign in with your password, then add it in Settings." };
  if (!pk || pk.user.disabled) return refused;
  if (pk.user.lockedUntil && pk.user.lockedUntil > new Date()) return { ok: false, error: "Too many tries. Wait 15 minutes, then sign in again." };
  const { rpID, origins } = rp();
  try {
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      credential: { id: pk.credentialId, publicKey: new Uint8Array(pk.publicKey), counter: pk.counter, transports: transportsOf(pk.transports) },
      requireUserVerification: true,
    });
    if (!v.verified) return refused;
    await db.passkey.update({ where: { id: pk.id }, data: { counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() } });
    await db.user.update({ where: { id: pk.user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
    return { ok: true, user: pk.user };
  } catch (err) {
    console.warn("passkey login failed", (err as Error).message);
    return refused;
  }
}
