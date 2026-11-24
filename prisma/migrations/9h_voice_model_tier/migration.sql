-- Which AI model tier a voice agent runs on: auto | premium | fast (voice-model-rules.ts).
ALTER TABLE "Receptionist" ADD COLUMN "voiceModelTier" TEXT NOT NULL DEFAULT 'auto';
