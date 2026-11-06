-- AlterTable
ALTER TABLE "Receptionist" ADD COLUMN     "callerDailyCalls" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "callerDailyMinutes" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "guardReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "guardTrippedAt" TIMESTAMP(3),
ADD COLUMN     "lineDailyMinutes" INTEGER NOT NULL DEFAULT 150,
ADD COLUMN     "maxCallMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "maxConcurrentCalls" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "silenceHangupSeconds" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "BlockedNumber" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedNumber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockedNumber_phone_key" ON "BlockedNumber"("phone");

-- Demo agents and our own line: 15-minute calls; the live demo builder: 30.
UPDATE "Receptionist" SET "maxCallMinutes" = 15 WHERE "lifecycle" = 'demo' OR "bookingAddsToCrm" = true;
UPDATE "Receptionist" SET "maxCallMinutes" = 30 WHERE "agentType" = 'builder';
