// Starting templates for new agents (pure; unit tested). Every agent the app creates (CRM
// "+ Receptionist", demo agents from every path, follow-up agents) starts from one, so the
// best-practice setup is always there: a greeting that says calls are recorded, a persona,
// escalation rules, booking defaults, customer texts and check-ins, and starter knowledge.
// Safety rules aren't here: they're generated into every prompt on sync (safety-rules.ts) and
// can't be edited per agent.

import { tradeFor } from "./discovery-rules";

export type TemplateKey = "auto_repair" | "contractor" | "retail" | "general" | "followup";

type KbStarter = { category: string; title: string; content: string; active: boolean };

export type AgentTemplate = {
  key: TemplateKey;
  label: string;
  settings: {
    persona: string;
    greeting: (o: { businessName: string; name: string }) => string;
    escalationRules: string;
    bookingTitle: string;
    bookingSlotMinutes: number;
    bookingHours: string;
    bookingMinNoticeHours: number;
    bookingDaysAhead: number;
    bookingQuestions: string;
    followUpOn: string;
    followUpChannel: string;
    leadAlertOn: string;
    rescueTextsOn: boolean;
    smsAgentOn: boolean;
    remindersOn: boolean;
    checkinsOn: boolean;
    checkinThreshold: number;
  };
  knowledge: KbStarter[];
};

const recorded = (o: { businessName: string; name: string }, ask = "How can I help you today?") =>
  `Thanks for calling ${o.businessName}, this is ${o.name}. Just so you know, calls are recorded. ${ask}`;

/** Facts that are true for every client on our platform, so every agent knows them from day one. */
const PLATFORM_FACTS: KbStarter[] = [
  { category: "POLICY", title: "Payment details over the phone", content: "We never take credit card, banking or other payment details over the phone or by text. The team handles payment directly and securely.", active: true },
  { category: "POLICY", title: "Call recording", content: "Calls are recorded so the team can follow up accurately and improve service.", active: true },
  { category: "POLICY", title: "Emergencies", content: "If anyone is in danger (fire, a gas smell, carbon monoxide, an injury or a medical emergency), call 911 right away.", active: true },
];

/** Entries the team fills in for each client: switched off until they're written. */
const fillIn = (category: string, title: string, hint: string): KbStarter => ({ category, title, content: `TO FILL IN: ${hint}`, active: false });

const COMMON_FILL_INS: KbStarter[] = [
  fillIn("HOURS", "Business hours", "Opening hours for each day, and holiday closures."),
  fillIn("LOCATION", "Address and service area", "Street address, parking, and the areas the business serves."),
  fillIn("PRICING", "Pricing", "Prices the receptionist may quote, or 'we quote after seeing the job'."),
];

export const AGENT_TEMPLATES: Record<TemplateKey, AgentTemplate> = {
  auto_repair: {
    key: "auto_repair",
    label: "Auto repair / mechanic",
    settings: {
      persona: "Friendly, practical and quick, like an experienced service advisor. Plain words, no jargon, one question at a time.",
      greeting: (o) => recorded(o),
      escalationRules: "If a caller is stranded, unsafe to drive, upset, or asks for a person, offer to transfer or take an urgent message. Parts suppliers and other shops go to the parts desk or a message for the owner.",
      bookingTitle: "Vehicle drop-off",
      bookingSlotMinutes: 30,
      bookingHours: "Mon-Fri 08:00-17:00",
      bookingMinNoticeHours: 2,
      bookingDaysAhead: 14,
      bookingQuestions: "What's the year, make and model of the vehicle?\nWhat's it doing, or what service do you need?",
      followUpOn: "bookings",
      followUpChannel: "sms",
      leadAlertOn: "messages",
      rescueTextsOn: true,
      smsAgentOn: true,
      remindersOn: true,
      checkinsOn: true,
      checkinThreshold: 3,
    },
    knowledge: [
      ...PLATFORM_FACTS,
      ...COMMON_FILL_INS,
      fillIn("SERVICE", "Services and vehicles", "Repairs and maintenance offered, and anything not worked on (makes, diesel, EVs)."),
      fillIn("FAQ", "Shuttle, loaners and waiting", "Courtesy car, shuttle or waiting area, and drop-off/key procedure."),
      fillIn("POLICY", "Warranty and diagnostics", "Warranty on parts and labour; diagnostic fee and whether it applies to the repair."),
    ],
  },
  contractor: {
    key: "contractor",
    label: "Contractor / home services",
    settings: {
      persona: "Warm, clear and efficient, like a seasoned dispatcher. Plain words, one question at a time.",
      greeting: (o) => recorded(o),
      escalationRules: "If it's an emergency (flooding, no heat in winter, sparking, a gas smell, anything unsafe), or the caller is upset or asks for a person, offer to transfer or take an urgent message. Suppliers and sub-trades get a message for the owner.",
      bookingTitle: "Estimate visit",
      bookingSlotMinutes: 60,
      bookingHours: "Mon-Fri 08:00-17:00",
      bookingMinNoticeHours: 4,
      bookingDaysAhead: 21,
      bookingQuestions: "What's the job, roughly?\nWhat's the address of the property?",
      followUpOn: "bookings",
      followUpChannel: "sms",
      leadAlertOn: "messages",
      rescueTextsOn: true,
      smsAgentOn: true,
      remindersOn: true,
      checkinsOn: true,
      checkinThreshold: 3,
    },
    knowledge: [
      ...PLATFORM_FACTS,
      ...COMMON_FILL_INS,
      fillIn("SERVICE", "Services offered", "The work done, and jobs turned down."),
      fillIn("POLICY", "Estimates and emergencies", "Whether estimates are free; emergency or after-hours service and any extra charge."),
      fillIn("POLICY", "Licences, insurance and warranty", "Licensing, insurance and workmanship warranty, as the owner wants it described."),
    ],
  },
  retail: {
    key: "retail",
    label: "Retail / storefront",
    settings: {
      persona: "Friendly and upbeat, like a helpful person at the front counter. Short answers, one question at a time.",
      greeting: (o) => recorded(o),
      escalationRules: "If a caller is upset, has a problem with an order, or asks for a person, offer to transfer or take a message. Deliveries and suppliers go to a message for the owner.",
      bookingTitle: "Appointment",
      bookingSlotMinutes: 30,
      bookingHours: "Mon-Sat 10:00-17:00",
      bookingMinNoticeHours: 2,
      bookingDaysAhead: 14,
      bookingQuestions: "What would you like to book?",
      followUpOn: "bookings",
      followUpChannel: "sms",
      leadAlertOn: "messages",
      rescueTextsOn: true,
      smsAgentOn: true,
      remindersOn: true,
      checkinsOn: true,
      checkinThreshold: 3,
    },
    knowledge: [
      ...PLATFORM_FACTS,
      ...COMMON_FILL_INS,
      fillIn("SERVICE", "What we sell and do", "Main products and services, and what's booked versus walk-in."),
      fillIn("POLICY", "Returns and exchanges", "The return and exchange policy, word for word."),
      fillIn("FAQ", "Stock, special orders and delivery", "How to check stock, special orders, delivery or pickup."),
    ],
  },
  general: {
    key: "general",
    label: "Other service business",
    settings: {
      persona: "Warm, concise and professional. Plain words, one question at a time.",
      greeting: (o) => recorded(o),
      escalationRules: "If the caller is upset, has an urgent problem, or asks for a person, offer to transfer or take an urgent message.",
      bookingTitle: "Appointment",
      bookingSlotMinutes: 30,
      bookingHours: "Mon-Fri 09:00-17:00",
      bookingMinNoticeHours: 2,
      bookingDaysAhead: 14,
      bookingQuestions: "What would you like help with?",
      followUpOn: "bookings",
      followUpChannel: "caller_choice",
      leadAlertOn: "messages",
      rescueTextsOn: true,
      smsAgentOn: true,
      remindersOn: true,
      checkinsOn: true,
      checkinThreshold: 3,
    },
    knowledge: [...PLATFORM_FACTS, ...COMMON_FILL_INS, fillIn("SERVICE", "Services offered", "The main services, and what isn't offered.")],
  },
  followup: {
    key: "followup",
    label: "Follow-Up Agent (calls website leads)",
    settings: {
      persona: "Warm, upbeat and to the point. Sounds like a helpful person from the office, never pushy.",
      greeting: (o) => recorded(o),
      escalationRules: "If the person is upset, asks for a person, or the request is urgent, offer to have the owner call them back right away.",
      bookingTitle: "Appointment",
      bookingSlotMinutes: 30,
      bookingHours: "Mon-Fri 09:00-17:00",
      bookingMinNoticeHours: 2,
      bookingDaysAhead: 14,
      bookingQuestions: "",
      followUpOn: "bookings",
      followUpChannel: "sms",
      leadAlertOn: "leads",
      rescueTextsOn: false,
      smsAgentOn: false,
      remindersOn: true,
      checkinsOn: false,
      checkinThreshold: 3,
    },
    knowledge: [...PLATFORM_FACTS],
  },
};

export const TEMPLATE_KEYS = Object.keys(AGENT_TEMPLATES) as TemplateKey[];

/** The template for a business from its CRM industry (follow-up agents use their own). */
export function templateFor(industry: string | null | undefined, agentType = "inbound"): AgentTemplate {
  if (agentType === "followup") return AGENT_TEMPLATES.followup;
  const trade = tradeFor(industry);
  return AGENT_TEMPLATES[trade === "mechanics" ? "auto_repair" : trade === "contractors" ? "contractor" : trade === "retail" ? "retail" : "general"];
}

/** Settings for a new agent; Canadian businesses get BC statutory holidays switched on. */
export function templateSettings(t: AgentTemplate, o: { businessName: string; name: string; canadian: boolean }) {
  const { greeting, ...rest } = t.settings;
  return { ...rest, greeting: greeting({ businessName: o.businessName, name: o.name }), bookingHolidays: o.canadian ? "CA-BC" : "" };
}

/**
 * Applying a template to an existing agent fills only what's still blank or at the factory
 * default, so nothing the team or client set is overwritten. Returns just the fields to change.
 */
const FACTORY: Record<string, unknown> = { persona: "Warm, concise, professional.", greeting: "", escalationRules: "", bookingTitle: "Discovery call", bookingQuestions: "", followUpOn: "", leadAlertOn: "" };

export function templateGaps(current: Record<string, unknown>, t: AgentTemplate, o: { businessName: string; name: string }): Record<string, unknown> {
  const wanted = { ...t.settings, greeting: t.settings.greeting(o) } as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(FACTORY)) {
    const cur = current[k];
    if ((cur === undefined || cur === null || cur === "" || cur === FACTORY[k]) && wanted[k] !== undefined && wanted[k] !== cur) out[k] = wanted[k];
  }
  return out;
}

/** Starter knowledge not already there (matched by title). */
export function missingStarters(t: AgentTemplate, existingTitles: string[]): KbStarter[] {
  const have = new Set(existingTitles.map((x) => x.trim().toLowerCase()));
  return t.knowledge.filter((k) => !have.has(k.title.toLowerCase()));
}

export function isCanadian(o: { state?: string | null; timezone?: string }): boolean {
  return Boolean(o.state && /^(BC|AB|SK|MB|ON|QC|NB|NS|PE|NL|YT|NT|NU)$/i.test(o.state.trim())) || /Vancouver|Edmonton|Winnipeg|Toronto|Halifax|Regina|Whitehorse|Montreal/.test(o.timezone ?? "");
}
