// Digital Asset Links: tells Chrome the Head Above Android app belongs to this site, so the app
// shows the CRM full screen (no address bar). ANDROID_CERT_SHA256 holds the app signing key's
// SHA-256 fingerprint(s), comma-separated (e.g. the upload key and Google Play's app signing key).
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ANDROID_PACKAGE = "com.headabovedigital.crm";

export function GET() {
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "")
    .split(/[\s,]+/)
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  const body = fingerprints.length
    ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints } }]
    : [];
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
}
