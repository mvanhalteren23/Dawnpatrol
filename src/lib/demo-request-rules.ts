// "Hear it answer as your business" (pure; unit tested): the website form that builds a prospect's
// own demo receptionist and texts them the number to call.

/** At most this many website demo builds an hour (each one costs research and voice setup). */
export const DEMO_BUILDS_PER_HOUR = 12;
/** One build per phone number a day. */
export const DEMO_BUILDS_PER_PHONE_PER_DAY = 1;

const first = (name: string) => name.trim().split(/\s+/)[0] ?? "";

export function demoReadyText(o: { firstName: string; business: string; agent: string; number: string; extension: string }): string {
  const hi = first(o.firstName) ? `Hi ${first(o.firstName)}, ` : "Hi, ";
  return `${hi}it's Head Above Digital. Your demo receptionist for ${o.business} is ready. Call ${o.number} and enter extension ${o.extension} to hear ${o.agent} answer as your business. Try asking about your hours, services or booking. Reply STOP to opt out.`;
}

export function demoDelayedText(firstName: string, business: string): string {
  const hi = first(firstName) ? `Hi ${first(firstName)}, ` : "Hi, ";
  return `${hi}it's Head Above Digital. We're still putting the finishing touches on the demo receptionist for ${business}. We'll call you shortly with your demo number. Reply STOP to opt out.`;
}

/** A website address someone typed: "shop.ca", "www.shop.ca/about" or a full URL. */
export function cleanWebsite(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return null;
    return `${u.protocol}//${u.hostname}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return null;
  }
}

export type DemoRequestInput = { name: string; business: string; website: string; city: string; phone: string; consent: boolean };

/** What's missing or wrong, in plain words; null when it's good to go. */
export function demoRequestProblem(i: DemoRequestInput, dialable: boolean): string | null {
  if (!i.business.trim()) return "Add your business name.";
  if (!i.name.trim()) return "Add your name.";
  if (!dialable) return "Add a Canadian or US mobile number with area code, so we can text you the demo.";
  if (i.website.trim() && !cleanWebsite(i.website)) return "That website address doesn't look right.";
  if (!cleanWebsite(i.website) && !i.city.trim()) return "Add your website, or at least your town, so we find the right business.";
  if (!i.consent) return "Tick the box so we can text you the demo number.";
  return null;
}
