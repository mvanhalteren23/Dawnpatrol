-- Demo vs production agents: demos expire after 30 idle days and can be promoted to production.
ALTER TABLE "Receptionist" ADD COLUMN "lifecycle" TEXT NOT NULL DEFAULT 'production';
ALTER TABLE "Receptionist" ADD COLUMN "expiredAt" TIMESTAMP(3);
ALTER TABLE "Receptionist" ADD COLUMN "promotedFromId" TEXT;

-- Existing demos: on the demo line, not our own line, and not on a client's account.
UPDATE "Receptionist" r SET "lifecycle" = 'demo'
FROM "Account" a
WHERE a."id" = r."accountId"
  AND r."demoExtension" IS NOT NULL
  AND r."bookingAddsToCrm" = false
  AND r."agentType" = 'inbound'
  AND a."stage" NOT IN ('ONBOARDING', 'ACTIVE', 'PAST_DUE');
