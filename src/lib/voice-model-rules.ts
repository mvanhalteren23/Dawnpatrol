// Which AI model each voice agent thinks with (set on the ElevenLabs agent when it's synced).
// Two tiers: "premium" for calls that make or lose money (Grace, booking lines, follow-up calls),
// "fast" for short, simple calls (website and prospect demos). Each receptionist can override.

export type VoiceTier = "premium" | "fast";
export type VoiceTierChoice = "auto" | VoiceTier;
export const VOICE_TIER_CHOICES: VoiceTierChoice[] = ["auto", "premium", "fast"];

export const VOICE_MODELS_KEY = "voice.models";

export const DEFAULT_VOICE_MODELS: Record<VoiceTier, string> = {
  premium: process.env.ELEVENLABS_LLM || "claude-sonnet-5-5",
  fast: "claude-haiku-5-5",
};

/** ElevenLabs model ids are lowercase letters, digits, dots, dashes and @ (checked before saving). */
export function validVoiceModel(m: unknown): m is string {
  return typeof m === "string" && /^[a-z0-9][a-z0-9.@-]{1,60}$/.test(m.trim());
}

export function parseTierChoice(v: unknown): VoiceTierChoice {
  return VOICE_TIER_CHOICES.includes(v as VoiceTierChoice) ? (v as VoiceTierChoice) : "auto";
}

type Agent = { voiceModelTier?: string | null; lifecycle?: string | null; agentType?: string | null };

/** The tier an agent runs on: its own choice, else demos on fast and everything else on premium. */
export function voiceTierFor(r: Agent): VoiceTier {
  const choice = parseTierChoice(r.voiceModelTier);
  if (choice !== "auto") return choice;
  return r.lifecycle === "demo" ? "fast" : "premium";
}

/** The saved models, with defaults for anything missing or invalid. */
export function voiceModels(saved: Partial<Record<VoiceTier, unknown>> | null | undefined): Record<VoiceTier, string> {
  return {
    premium: validVoiceModel(saved?.premium) ? saved!.premium.trim() : DEFAULT_VOICE_MODELS.premium,
    fast: validVoiceModel(saved?.fast) ? saved!.fast.trim() : DEFAULT_VOICE_MODELS.fast,
  };
}

export function voiceModelFor(r: Agent, models: Record<VoiceTier, string>): string {
  return models[voiceTierFor(r)];
}

export const TIER_LABEL: Record<VoiceTierChoice, string> = {
  auto: "Automatic (demos fast, everything else premium)",
  premium: "Premium: best answers (bookings, sales)",
  fast: "Fast: cheaper and quicker (simple message-taking lines)",
};
