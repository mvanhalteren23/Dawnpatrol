-- Known callers: the trusted-number list grows a name, a note and how the line should handle the
-- number (known-caller-rules.ts), and can be filled from a client's customer list.
ALTER TABLE "TrustedNumber" ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TrustedNumber" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TrustedNumber" ADD COLUMN "handling" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "TrustedNumber" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "TrustedNumber" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
