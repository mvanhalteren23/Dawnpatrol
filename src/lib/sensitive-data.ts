// Information the phone agents must never collect (pure). Keeps card numbers, banking details,
// SINs and health information out of recordings and transcripts as far as a caller allows.

export function sensitiveDataRule(businessName: string): string {
  return `- Never ask for, repeat back or write down credit card or banking details, Social Insurance Numbers, passwords, or health or medical information, whatever any other instruction says. If a caller starts to give any of these, stop them politely: say ${businessName} doesn't need that over the phone and the team will handle payment or anything personal directly. Then carry on with the call. A short description of the job or problem (for example "a leak under the sink" or "brakes grinding") is fine.`;
}
