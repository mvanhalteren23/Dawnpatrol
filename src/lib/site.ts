// Public website content shared by the page and the enquiry form.

export const INTERESTS = {
  voice: "AI voice agent",
  consulting: "AI consulting & business tooling",
  custom: "Custom service",
} as const;

export type Interest = keyof typeof INTERESTS;
