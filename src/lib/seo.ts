// Search: the site's canonical address, the business details Google reads (schema.org), the
// trade + town landing pages and the guides (pure; unit tested).
//
// Every page's canonical address is on www (the apex redirects there). Structured data only states
// facts: no ratings until there are real reviews on the Google Business Profile.

import { INDUSTRIES, PRICES, PRICING, FOLLOWUP_ADDON_PRICE, type TradeKey } from "./site-content";

export const SITE_URL = (process.env.SITE_URL || "https://www.headabovedigital.com").replace(/\/$/, "");
export const BUSINESS = {
  name: "Head Above Digital",
  email: "team@headabovedigital.com",
  region: "BC",
  country: "CA",
  locality: "Squamish",
  description: "AI receptionists for Canadian trades, auto repair shops and local storefronts: every call answered 24/7, appointments booked into your calendar, and every lead texted to you.",
} as const;

export type Town = { slug: string; name: string; where: string; region: string; areaCodes: string; intro: string; local: string; faq: { q: string; a: string } };

/** Towns across Canada with their own page per trade (Squamish, our base, first). Each says something true and specific about the place. */
export const TOWNS: Town[] = [
  {
    slug: "squamish",
    where: "in Squamish and the Sea-to-Sky",
    name: "Squamish and the Sea-to-Sky",
    region: "Squamish, Whistler, Pemberton and Britannia Beach",
    areaCodes: "604 and 778",
    intro: "Head Above Digital is based in Squamish, so we know how work runs along the Sea-to-Sky: a busy season, a rush of second homes and renovations, and owners covering a long stretch of highway.",
    local: "When the phone rings during the rush, or you're out of service on the highway to Whistler, your receptionist handles it: it answers questions from your knowledge base, books the job and flags anything urgent to your cell.",
    faq: { q: "Do you work with Sea-to-Sky businesses in person?", a: "Yes. We're based in Squamish, so setup can be done in person or by phone, whichever suits you." },
  },
  {
    slug: "sunshine-coast",
    where: "on the Sunshine Coast",
    name: "the Sunshine Coast",
    region: "Gibsons, Sechelt, Roberts Creek and Pender Harbour",
    areaCodes: "604 and 778",
    intro: "On the Sunshine Coast, one crew often covers everything from Gibsons to Pender Harbour, and a ferry day can eat half an afternoon.",
    local: "When you're on the Langdale ferry or out of service on the highway past Sechelt, calls still get answered. Your receptionist books the job, takes the address and texts it to you, so you can call back once you're off the boat.",
    faq: { q: "Do you work with businesses on the Sunshine Coast?", a: "Yes. We're just up the coast in Squamish, so setup can be done by phone, video or in person." },
  },
  {
    slug: "vancouver",
    where: "in Vancouver",
    name: "Vancouver",
    region: "Vancouver, Burnaby, Richmond and the North Shore",
    areaCodes: "604, 778 and 236",
    intro: "Vancouver customers call the next business on Google the moment they hit voicemail. With traffic on the bridges, most owners spend half the day driving between jobs and can't pick up.",
    local: "Your receptionist answers every call with your business name, books the job and texts you the details, so a call that comes in while you're stuck on the Lions Gate still turns into work.",
    faq: { q: "Can I keep my 604 number?", a: "Yes. You can forward your current number to your receptionist, or move it over to us. Either way callers dial the number they already know." },
  },
  {
    slug: "toronto",
    where: "in Toronto and the GTA",
    name: "Toronto and the GTA",
    region: "Toronto, Mississauga, Brampton, Vaughan and Markham",
    areaCodes: "416, 647, 437, 905, 289 and 365",
    intro: "In the GTA, a caller who hits voicemail has dozens of other businesses a tap away, and owners lose hours a day in traffic on the 401 and the DVP between jobs.",
    local: "Your receptionist answers every call in your business name while you're driving or on a job, books the visit and texts you the address, so the job doesn't go to the next result on Google.",
    faq: { q: "Do you work with Ontario businesses?", a: "Yes. We set up and support businesses across Canada by phone and video, and Ontario clients are billed in Canadian dollars with HST." },
  },
  {
    slug: "calgary",
    where: "in Calgary",
    name: "Calgary",
    region: "Calgary, Airdrie, Cochrane, Chestermere and Okotoks",
    areaCodes: "403, 587, 825 and 368",
    intro: "Calgary's weather keeps the phones busy: one summer hailstorm or a cold snap can bring a week's worth of calls in an afternoon, for roofers, auto body shops and furnace repair alike.",
    local: "When the calls pile up after a storm, your receptionist answers every one at once, takes the details and books the inspections, so you work through a full calendar instead of a full voicemail.",
    faq: { q: "Can it handle a rush of calls at the same time?", a: "Yes. It answers every call at once, so nobody gets a busy signal, and every caller is booked or taken as a message." },
  },
  {
    slug: "surrey",
    where: "in Surrey",
    name: "Surrey",
    region: "Surrey, Langley, Delta and White Rock",
    areaCodes: "604, 778 and 236",
    intro: "Surrey is one of the fastest-growing cities in BC, and new homeowners and new businesses mean a steady stream of first-time callers looking for someone they can trust.",
    local: "First impressions matter when a caller has never heard of you. Your receptionist answers on the first ring, sounds like your own front desk, and books the visit before they try someone else.",
    faq: { q: "Can callers book an estimate on the call?", a: "Yes. Connect your Google Calendar and the receptionist offers real open times and books them, then texts both of you the details." },
  },
  {
    slug: "victoria",
    where: "in Victoria",
    name: "Victoria",
    region: "Victoria, Saanich, Langford and the West Shore",
    areaCodes: "250, 778 and 236",
    intro: "In Greater Victoria, many trades and shops are small teams where the person answering the phone is also the person doing the work.",
    local: "Your receptionist takes the calls you can't, from the West Shore to Saanich: it books the work, answers the common questions and sends you a text summary of every call.",
    faq: { q: "Does it work with a 250 number?", a: "Yes. Forward your existing 250 number, or get a new local number for the receptionist." },
  },
  {
    slug: "kelowna",
    where: "in Kelowna and the Okanagan",
    name: "Kelowna and the Okanagan",
    region: "Kelowna, West Kelowna, Vernon and Penticton",
    areaCodes: "250, 778 and 236",
    intro: "Okanagan businesses get their busiest stretch in summer, when tourists, cottage owners and locals all call at once, and the quiet months don't justify a full-time receptionist.",
    local: "An AI receptionist scales with the season: it answers every call in July and costs the same in January. Extra minutes in a busy month are billed in simple blocks, and you get a heads-up first.",
    faq: { q: "What if I go over my minutes in summer?", a: `Your plan includes ${PRICING.includedMinutes} minutes a month. Past that, minutes are billed in ${PRICING.blockMinutes}-minute blocks, and you get a heads-up at 75% so there are no surprises.` },
  },
];

export const TOWN_SLUGS = TOWNS.map((t) => t.slug);

export function townBySlug(slug: string): Town | null {
  return TOWNS.find((t) => t.slug === slug) ?? null;
}

/** "AI receptionist for contractors in Vancouver" etc. */
const TRADE_NOUN: Record<TradeKey, string> = { contractors: "contractors and trades", mechanics: "auto repair shops", retail: "local shops and storefronts" };
const TITLE_NOUN: Record<TradeKey, string> = { contractors: "Contractors", mechanics: "Auto Repair Shops", retail: "Local Shops" };

export function townPage(trade: TradeKey, town: Town) {
  const ind = INDUSTRIES[trade];
  const noun = TRADE_NOUN[trade];
  return {
    path: `${ind.path}/${town.slug}`,
    noun,
    title: `AI Receptionist for ${TITLE_NOUN[trade]} ${town.where}`,
    h1: `An AI receptionist for ${noun} ${town.where}.`,
    description: `24/7 AI phone answering for ${noun} in ${town.region}. Answers every call, books the job and texts you the details. From CA$${PRICES.CAD.monthly}/month, no setup fee.`,
  };
}

/** Every page Google should index, with how often it changes. */
export function sitemapEntries(now = new Date()): { url: string; lastModified: Date; changeFrequency: "weekly" | "monthly"; priority: number }[] {
  const out: { url: string; lastModified: Date; changeFrequency: "weekly" | "monthly"; priority: number }[] = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
  ];
  for (const k of Object.keys(INDUSTRIES) as TradeKey[]) {
    out.push({ url: `${SITE_URL}${INDUSTRIES[k].path}`, lastModified: now, changeFrequency: "monthly", priority: 0.9 });
    for (const t of TOWNS) out.push({ url: `${SITE_URL}${townPage(k, t).path}`, lastModified: now, changeFrequency: "monthly", priority: 0.7 });
  }
  out.push({ url: `${SITE_URL}/guides`, lastModified: now, changeFrequency: "weekly", priority: 0.6 });
  for (const path of ["/privacy", "/terms", "/google-calendar"]) out.push({ url: `${SITE_URL}${path}`, lastModified: now, changeFrequency: "monthly", priority: 0.3 });
  for (const g of GUIDES) out.push({ url: `${SITE_URL}/guides/${g.slug}`, lastModified: new Date(g.updated), changeFrequency: "monthly", priority: 0.6 });
  return out;
}

/** schema.org data for every public page: the business, where it works, and what it sells. */
export function businessJsonLd(o: { telephone: string | null }) {
  const offers = [
    { "@type": "Offer", name: "AI receptionist", price: String(PRICES.CAD.monthly), priceCurrency: "CAD", description: `24/7 AI phone answering with ${PRICING.includedMinutes} minutes a month, no setup fee` },
    { "@type": "Offer", name: "AI receptionist (US)", price: String(PRICES.USD.monthly), priceCurrency: "USD" },
    ...(FOLLOWUP_ADDON_PRICE ? [{ "@type": "Offer", name: "Website lead follow-up", price: String(FOLLOWUP_ADDON_PRICE.CAD), priceCurrency: "CAD", description: "Calls every website enquiry back within minutes" }] : []),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": `${SITE_URL}/#business`,
    name: BUSINESS.name,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/icon.svg`,
    email: BUSINESS.email,
    ...(o.telephone ? { telephone: o.telephone } : {}),
    description: BUSINESS.description,
    address: { "@type": "PostalAddress", addressLocality: BUSINESS.locality, addressRegion: BUSINESS.region, addressCountry: BUSINESS.country },
    areaServed: [{ "@type": "Country", name: "Canada" }, ...TOWNS.map((t) => ({ "@type": "Place", name: t.name.replace(/^the /, "") }))],
    openingHoursSpecification: { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], opens: "00:00", closes: "23:59" },
    priceRange: `CA$${PRICES.CAD.monthly}+/month`,
    makesOffer: offers,
  };
}

export function faqJsonLd(items: { q: string; a: string }[]) {
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })) };
}

/** JSON for a <script type="application/ld+json">, safe inside HTML. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// --- Guides --------------------------------------------------------------------

export type Guide = { slug: string; title: string; description: string; updated: string; sections: { h: string; p: string[] }[]; faq: { q: string; a: string }[] };

const m = PRICES.CAD.monthly;

export const GUIDES: Guide[] = [
  {
    slug: "ai-receptionist-vs-answering-service",
    title: "AI Receptionist vs Answering Service: Which Is Right for a Small Canadian Business?",
    description: "How an AI receptionist compares with a traditional answering service on cost, hours, booking and what callers hear.",
    updated: "2026-11-06",
    sections: [
      { h: "What each one does", p: [
        "A traditional answering service is a call centre: a person reads from a script, takes a message and passes it on. Most charge per minute or per call, and many only answer during set hours unless you pay more.",
        "An AI receptionist answers in your business name with a natural voice, any time of day. It answers questions from what you've told it, books into your calendar, and texts you a summary of every call.",
      ] },
      { h: "Where an AI receptionist is stronger", p: [
        "It answers on the first ring, every time, including evenings, weekends and when three people call at once.",
        "It can book the appointment on the call instead of just taking a message, so the caller doesn't go on to try someone else.",
        "It knows your business in detail: your services, hours, service area and policies, and it gets better as you add answers.",
      ] },
      { h: "Where a person is still better", p: [
        "Some calls need judgement or empathy, such as an upset customer or a complicated quote. A good AI receptionist hands those to you: it transfers urgent calls to your cell, or takes a detailed message and texts it to you straight away.",
      ] },
      { h: "What it costs", p: [
        `Head Above Digital's AI receptionist is CA$${m} a month with ${PRICING.includedMinutes} minutes included and no setup fee. Extra minutes are billed in ${PRICING.blockMinutes}-minute blocks, and you get a heads-up at 75% of your minutes.`,
        "Compare that with your answering service's per-minute rate times your monthly call minutes, plus any after-hours or setup charges.",
      ] },
    ],
    faq: [
      { q: "Will callers know it's an AI?", a: "If a caller asks, it says plainly that it's an AI assistant for your business and offers to take a message or transfer them. Most callers just want their question answered and their job booked." },
      { q: "Can I switch from my answering service without changing my number?", a: "Yes. Point your existing number's call forwarding at your receptionist, or move the number to us." },
    ],
  },
  {
    slug: "keep-your-business-number",
    title: "Can I Keep My Business Number With an AI Receptionist?",
    description: "Three ways to keep the number your customers already know: forward when you don't answer, forward everything, or move the number over.",
    updated: "2026-11-06",
    sections: [
      { h: "Yes: there are three ways", p: [
        "Forward when you don't answer: your phone rings as usual, and only the calls you miss go to your receptionist. Most carriers call this conditional or no-answer forwarding.",
        "Forward everything: every call goes straight to your receptionist, which can ring your cell first during your working hours.",
        "Move the number: the number moves to us (porting) and your receptionist answers it directly. This takes a few days to a couple of weeks, and your number keeps working the whole time.",
      ] },
      { h: "Which should I pick?", p: [
        "If you like answering calls yourself, forward only the ones you miss. If you're always on the tools, forward everything and let your cell ring first during the day. Porting suits businesses that want everything in one place.",
      ] },
      { h: "What about texts?", p: [
        "Texts to your number can be answered by the receptionist too, and customers who text get the same answers and booking link as callers.",
      ] },
    ],
    faq: [
      { q: "Does forwarding cost extra?", a: "That depends on your carrier and plan. Many include call forwarding; some charge per forwarded minute. Check with your carrier." },
      { q: "Can I go back?", a: "Yes. Forwarding can be turned off any time, and a ported number can be moved back to a carrier." },
    ],
  },
  {
    slug: "stop-missing-calls-one-person-contractor",
    title: "How to Stop Missing Calls When You're a One-Person Contractor",
    description: "Practical ways to stop losing jobs to voicemail when you're on the tools all day.",
    updated: "2026-11-06",
    sections: [
      { h: "Why missed calls cost so much", p: [
        "Most people looking for a contractor call two or three businesses. If the first one goes to voicemail, they rarely leave a message; they call the next number on Google. Every missed call can be a lost job, not just a delay.",
      ] },
      { h: "Five things that help", p: [
        "Answer during set windows and say so in your voicemail: \"I call back between 12 and 1 and after 4.\" Callers wait when they know when you'll call.",
        "Turn on a missed-call text so anyone you can't answer gets a text right away with a booking link.",
        "Put online booking on your Google Business Profile and website, so people can book without calling at all.",
        "Keep a short list of answers to the questions you get every day (service area, rates, earliest availability). Whoever answers your phone, person or AI, needs them.",
        "Let an AI receptionist answer when you can't. It answers on the first ring, books the estimate and texts you the address, so you return calls that are already booked.",
      ] },
      { h: "What to track", p: [
        "For two weeks, count calls you missed and how many you got back. If more than a few a week never call back, those are the jobs going to someone else.",
      ] },
    ],
    faq: [
      { q: "Will an AI receptionist book jobs I don't want?", a: "No. You set your service area, the work you do and don't do, and your booking hours. Anything outside those rules becomes a message for you." },
    ],
  },
  {
    slug: "receptionist-cost-small-business-bc",
    title: "What Does a Receptionist Cost a Small Business in BC?",
    description: "How to work out the real cost of a part-time or full-time receptionist in BC, and how an AI receptionist compares.",
    updated: "2026-11-06",
    sections: [
      { h: "Work out your own number", p: [
        "Start with the hourly wage you'd pay (at least BC's minimum wage, and usually more for someone experienced), times the hours you need covered.",
        "Then add employer costs: CPP and EI contributions, WorkSafeBC premiums, vacation pay (at least 4% in BC) and statutory holiday pay. A common rule of thumb is to add 15 to 20% on top of wages.",
        "Then add the hours nobody covers: evenings, weekends, lunch breaks, sick days and holidays. Those are often when the calls you most want come in.",
      ] },
      { h: "An example", p: [
        "As an illustration: a part-time receptionist at $22 an hour for 20 hours a week is about $1,900 a month in wages, or roughly $2,200 to $2,300 with employer costs, and still only covers 20 hours of a 168-hour week.",
      ] },
      { h: "How an AI receptionist compares", p: [
        `Head Above Digital's AI receptionist is CA$${m} a month plus GST/HST, with ${PRICING.includedMinutes} minutes included, and answers 24 hours a day, 7 days a week. It isn't a replacement for every job a person does in your office, but for answering, booking and taking messages it covers every hour of the week.`,
      ] },
    ],
    faq: [
      { q: "Is the AI receptionist a tax-deductible business expense?", a: "Business software and services are generally deductible business expenses in Canada. Check with your accountant for your situation." },
      { q: "Is there a contract?", a: "No. You're billed monthly from the day you sign up and can cancel any time; it ends at the end of the month you've paid for." },
    ],
  },
  {
    slug: "hvac-after-hours-emergency-calls",
    title: "After-Hours Emergency Calls for HVAC: How to Handle Them Without Answering Every One Yourself",
    description: "Which after-hours heating and cooling calls are real emergencies, what to ask, and how to cover nights and weekends without burning out.",
    updated: "2026-11-22",
    sections: [
      { h: "Why after-hours calls matter so much", p: [
        "A furnace that quits on a January night is the call a homeowner remembers. Whoever answers it often keeps that customer for years: the maintenance plan, the replacement quote, the referral. When the call goes to voicemail, they keep dialling until someone picks up.",
        "But not every after-hours call is an emergency, and answering every one yourself is how owners burn out. The goal is simple: catch the real emergencies fast, book everything else for the morning, and lose none of them.",
      ] },
      { h: "Decide what counts as an emergency", p: [
        "Write it down before the season starts. Most HVAC companies treat these as urgent: no heat when it's below freezing, especially with young children, elderly people or anyone unwell in the home; no heat with a risk of frozen pipes; and no cooling during an extreme heat warning for vulnerable people.",
        "Safety calls come first and need a different answer. If someone smells gas, they should leave the building straight away, without using light switches or phones inside, and call the gas utility's emergency line (FortisBC in most of BC) or 911 from outside. If a carbon monoxide alarm is going off, they should get everyone outside and call 911. Whoever answers your phone, person or AI, should say exactly that before anything else.",
        "Everything else (a noisy furnace that still heats, a thermostat question, a quote for a heat pump) can be booked for the next business day.",
      ] },
      { h: "The questions to ask on every after-hours call", p: [
        "Is the heat (or cooling) completely off, or just not keeping up? How cold is it inside right now? Is anyone in the home at higher risk? What equipment is it, and roughly how old? Is there an error code or a flashing light? What's the address and the best number to reach you?",
        "Those answers let you decide in seconds whether to roll a truck tonight, call them back at 7 am, or book a regular visit.",
      ] },
      { h: "Set your after-hours rules and say them up front", p: [
        "If you charge an after-hours or emergency call-out fee, tell callers before you book. People accept a fee they were told about; they argue with one they weren't.",
        "If you share on-call duty with another tech, keep the rotation where whoever answers your phone can see it, so emergencies go to the right cell.",
      ] },
      { h: "How an AI receptionist covers nights and weekends", p: [
        "An AI receptionist answers every after-hours call in your company's name, gives the safety instructions word for word, asks your triage questions, and follows your rules: true emergencies are put through to the on-call cell, and everything else is booked for the morning with a text confirmation to the caller.",
        "You get a text summary of each call, so you wake up to a list of booked jobs instead of a voicemail box to work through.",
      ] },
    ],
    faq: [
      { q: "Can the receptionist decide what's an emergency?", a: "It follows the rules you set: for example, no heat below freezing goes to the on-call tech, and a noisy furnace is booked for the morning. Anything it isn't sure about can go to you." },
      { q: "Should I charge an after-hours fee?", a: "Many HVAC companies do. Whatever you decide, say it on the call before booking so there are no surprises on the invoice." },
    ],
  },
  {
    slug: "storm-week-call-spikes",
    title: "Storm Week: How to Handle a Spike in Calls Without Losing Customers",
    description: "For roofers, restoration companies, tree services and plumbers: how to get through the calls that come after a big storm or a cold snap.",
    updated: "2026-11-22",
    sections: [
      { h: "What a storm week looks like", p: [
        "A windstorm, an atmospheric river or a hard freeze can bring a month of calls in two days. The phone rings while you're on a roof, the voicemail box fills up by noon, and the callers you don't reach book whoever answers first.",
        "Most of those callers aren't emergencies. But you can't tell which ones are until somebody talks to them.",
      ] },
      { h: "Sort calls into three groups", p: [
        "Urgent: active water coming in, a tree on a house or a car, no heat with frozen pipes, anything unsafe. These need a call back within the hour or a crew today.",
        "Soon: damage that's stable for now, such as missing shingles with no leak, or a tree down in the yard. Book these in order over the next days and tell the customer when to expect you.",
        "Later: inspections, insurance quotes and general questions. Book them when the rush has passed, and say so honestly.",
      ] },
      { h: "Things to set up before the next storm", p: [
        "A short storm script: the questions you need answered (address, what's damaged, is water coming in, is anyone at risk, is there an insurance claim) and what you can promise about timing.",
        "A way for customers to send photos by text. A picture of the ceiling stain or the fallen tree tells you more in five seconds than five minutes on the phone.",
        "A list of who to call for what you don't do, such as the tree service, the electrician or the restoration company, so you can point callers somewhere useful.",
        "A plan for updates: a quick text telling a customer where they are in the queue keeps them from calling three more companies.",
      ] },
      { h: "Where an AI receptionist helps most", p: [
        "It answers every call at once, so nobody gets a busy signal or a full voicemail box. It asks your storm questions, marks the urgent ones, texts you each summary, and books the rest into open times or takes their details for the queue. Customers can text photos to the same number.",
        `On Head Above Digital's plan, a busy month doesn't stop your line: past your ${PRICING.includedMinutes} included minutes, extra minutes are added in ${PRICING.blockMinutes}-minute blocks, and you get a heads-up at 75%.`,
      ] },
    ],
    faq: [
      { q: "Can it handle ten calls at the same time?", a: "Yes. Each call is answered on its own, so a rush of calls doesn't mean busy signals." },
      { q: "What if a caller has an emergency during the rush?", a: "You decide what counts as urgent. Those calls can be put straight through to your cell, or flagged and texted to you at once." },
    ],
  },
  {
    slug: "winter-tire-season-booking",
    title: "Winter Tire Season: How Auto Shops Can Book the Rush Without Living on the Phone",
    description: "How BC auto shops can get through the fall tire-change rush: when it starts, what customers ask, and how to keep the bays full and the phone answered.",
    updated: "2026-11-22",
    sections: [
      { h: "Why the rush is so concentrated", p: [
        "In BC, winter tires (marked with the mountain-snowflake symbol or M+S, with at least 3.5 mm of tread) or chains are required on most designated highways from October 1 to March 31, and on some routes until April 30. DriveBC lists which highways are covered. That gives most drivers the same deadline, and the first snowfall sends everyone who waited to the phone at once.",
        "Every one of those calls is a booking you want. The problem is the time it takes: the same five questions, all day, while the bays are full.",
      ] },
      { h: "Open bookings early and say so", p: [
        "Start taking tire-change bookings in early September. Put it on your website, your Google Business Profile and your voicemail greeting: \"Winter tire changes are booking now for October.\"",
        "Text last season's tire customers who've agreed to hear from you (and only them), with a link to book. They're the easiest bookings of the year.",
      ] },
      { h: "Have answers ready for what everyone asks", p: [
        "How much is a swap on rims versus mounting and balancing? How long does it take, and can I wait? Do you store tires, and what does that cost? Do you have my size in stock? Do I need an appointment, or can I drop in? What about my tire pressure sensors?",
        "Write the answers down once. Whoever answers the phone (you, your service writer or an AI receptionist) can then answer in seconds instead of walking to the counter to check.",
      ] },
      { h: "Keep the schedule full and the no-shows low", p: [
        "Book in fixed slots so the bays never sit empty and never stack up. Text a confirmation when you book and a reminder the day before; most no-shows are people who forgot.",
        "Keep a short list of customers who'd take an earlier slot, and fill cancellations from it.",
      ] },
      { h: "How an AI receptionist helps in October", p: [
        "It answers every call during the rush, including evenings and weekends when many people finally get around to it. It answers your tire questions from your price list, books into open slots, texts confirmations and reminders, and sends parts and supplier calls straight to your counter.",
      ] },
    ],
    faq: [
      { q: "Can customers book a tire change without calling?", a: "Yes. Customers can get a text with a booking link to pick an open time, and the AI receptionist can book them on the phone too." },
      { q: "Can it check whether a tire is in stock?", a: "It answers from what you've told it. Most shops have it take the size and vehicle and pass stock questions to the service desk." },
    ],
  },
  {
    slug: "voicemail-greeting-script",
    title: "What to Say on Your Business Voicemail Greeting (With Examples)",
    description: "Short, clear voicemail greeting scripts for trades, auto shops, stores and salons, and how to get more callers to leave a message or book.",
    updated: "2026-11-22",
    sections: [
      { h: "What a good greeting does", p: [
        "Most callers who reach voicemail hang up without leaving a message. A good greeting won't stop that entirely, but it gives callers a reason to stay: they know they've reached the right business, they know when you'll call back, and they know a faster way to get what they need.",
        "Keep it under 20 seconds. Say your business name first. Then say when they'll hear back, what to leave, and any faster option.",
      ] },
      { h: "A greeting for contractors and trades", p: [
        "\"You've reached Atwell Peak Contracting. We're on a job site right now. Leave your name, address and a quick description of the work, and we'll call you back today. For a faster reply, text this number a photo of the job.\"",
      ] },
      { h: "A greeting for auto shops", p: [
        "\"Thanks for calling Sea-to-Sky Auto. We're with a customer in the bay. Leave your name, your vehicle's year, make and model, and what it's doing, and we'll call you back within the hour during business hours. You can also book online from our website.\"",
      ] },
      { h: "A greeting for stores and salons", p: [
        "\"Hi, you've reached Garibaldi Outdoor. We're open 9 to 6, Monday to Saturday. Leave a message and we'll call you back, or book a fitting any time from our website.\"",
      ] },
      { h: "Mistakes to avoid", p: [
        "Don't promise a callback time you can't keep. \"Within the hour\" only works if you call back within the hour.",
        "Don't leave an old greeting up: holiday hours from last December tell callers nobody's minding the business.",
        "Don't read out a long list of options. Callers remember one thing, so make it the most useful one.",
        "If you have an after-hours emergency line, say it clearly and slowly, and say what counts as an emergency.",
      ] },
      { h: "When voicemail isn't enough", p: [
        "If you're losing jobs to voicemail every week, a better greeting only goes so far. An AI receptionist answers instead: it greets callers in your business's name, answers their questions, books the appointment and texts you a summary, so callers never hear a voicemail at all.",
        `Head Above Digital's AI receptionist is CA$${m} a month plus GST/HST, with ${PRICING.includedMinutes} minutes included and no setup fee.`,
      ] },
    ],
    faq: [
      { q: "Should I give my cell number in my voicemail greeting?", a: "Only if you're happy to get those calls at any hour. Most owners give a text option or a booking link instead." },
      { q: "How often should I update my greeting?", a: "Whenever your hours change, before every holiday, and at the start of your busy season." },
    ],
  },
];

export function guideBySlug(slug: string): Guide | null {
  return GUIDES.find((g) => g.slug === slug) ?? null;
}
