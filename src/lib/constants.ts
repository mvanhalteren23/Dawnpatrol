export const STAGES = [
  "PROSPECT",
  "CONTACTED",
  "ENGAGED",
  "DEMO",
  "PROPOSAL",
  "ONBOARDING",
  "ACTIVE",
  "PAST_DUE",
  "CHURNED",
  "LOST",
] as const;
export type Stage = (typeof STAGES)[number];

export const PROSPECT_STAGES: Stage[] = ["PROSPECT", "CONTACTED", "ENGAGED", "DEMO", "PROPOSAL"];
export const CLIENT_STAGES: Stage[] = ["ONBOARDING", "ACTIVE", "PAST_DUE"];

export const STAGE_LABELS: Record<Stage, string> = {
  PROSPECT: "Prospect",
  CONTACTED: "Contacted",
  ENGAGED: "Engaged",
  DEMO: "Demo booked",
  PROPOSAL: "Proposal sent",
  ONBOARDING: "Onboarding",
  ACTIVE: "Active client",
  PAST_DUE: "Past due",
  CHURNED: "Churned",
  LOST: "Lost",
};

export const ACTIVITY_TYPES = [
  "EMAIL",
  "CALL",
  "SMS",
  "LINKEDIN",
  "MEETING",
  "NOTE",
  "TASK",
  "STAGE_CHANGE",
  "RESEARCH",
  "BILLING",
] as const;

export const KB_CATEGORIES = [
  "FAQ",
  "SERVICE",
  "PRICING",
  "HOURS",
  "LOCATION",
  "POLICY",
  "STAFF",
  "SCRIPT",
  "OTHER",
] as const;
export type KbCategory = (typeof KB_CATEGORIES)[number];

export const KB_CATEGORY_LABELS: Record<KbCategory, string> = {
  FAQ: "FAQs",
  SERVICE: "Services",
  PRICING: "Pricing",
  HOURS: "Hours & availability",
  LOCATION: "Locations & service area",
  POLICY: "Policies",
  STAFF: "Staff & routing",
  SCRIPT: "Call scripts",
  OTHER: "Other",
};

export const CALL_OUTCOMES = [
  "BOOKED",
  "MESSAGE_TAKEN",
  "ANSWERED",
  "TRANSFERRED",
  "MISSED_OPPORTUNITY",
  "SPAM",
  "UNKNOWN",
] as const;

export const DRIVE_PURPOSES = [
  "ROOT",
  "RESEARCH",
  "OUTREACH",
  "CONTRACTS",
  "KNOWLEDGE_BASE",
  "CALL_LOGS",
  "BILLING",
] as const;
export type DrivePurpose = (typeof DRIVE_PURPOSES)[number];

export const DRIVE_SUBFOLDER_NAMES: Record<Exclude<DrivePurpose, "ROOT">, string> = {
  RESEARCH: "01 Research",
  OUTREACH: "02 Outreach",
  CONTRACTS: "03 Contracts & Onboarding",
  KNOWLEDGE_BASE: "04 Knowledge Base (RAG)",
  CALL_LOGS: "05 Call Logs",
  BILLING: "06 Billing",
};

// Prospects only need the sales folders; clients get the full set.
export const PROSPECT_SUBFOLDERS: Exclude<DrivePurpose, "ROOT">[] = ["RESEARCH", "OUTREACH"];
export const CLIENT_SUBFOLDERS: Exclude<DrivePurpose, "ROOT">[] = [
  "RESEARCH",
  "OUTREACH",
  "CONTRACTS",
  "KNOWLEDGE_BASE",
  "CALL_LOGS",
  "BILLING",
];

export const DEFAULT_CLIENT_GOAL = { min: 30, max: 50 };

// Days to wait after an unanswered outbound touch before a follow-up is due.
export const FOLLOW_UP_DAYS = 3;

export function isClientStage(stage: string): boolean {
  return (CLIENT_STAGES as string[]).includes(stage);
}
