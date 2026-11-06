// The current Terms of Service version (shown at checkout and recorded when a client accepts).
// Bump the date whenever the terms change materially.
export const TERMS_VERSION = "2026-11-06";
const SITE = (process.env.SITE_URL || "https://www.headabovedigital.com").replace(/\/$/, "");
export const SITE_TERMS_URL = `${SITE}/terms`;
export const SITE_PRIVACY_URL = `${SITE}/privacy`;
