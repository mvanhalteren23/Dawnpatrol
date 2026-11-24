-- Assistant tier: plan tier, per-line override, routing rules, owner PIN, and the caller directory.

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "tier" TEXT NOT NULL DEFAULT 'standard';

-- AlterTable
ALTER TABLE "Receptionist" ADD COLUMN     "assistantOverride" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "routingRules" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "labelDigestOn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ownerPinHash" TEXT,
ADD COLUMN     "ownerPinFails" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ownerPinLockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "KnownCaller" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "category" TEXT,
    "suggested" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "routeAction" TEXT NOT NULL DEFAULT '',
    "routeTo" TEXT,
    "source" TEXT NOT NULL DEFAULT 'call',
    "digestNumber" INTEGER,
    "askedAt" TIMESTAMP(3),
    "lastCallId" TEXT,
    "lastCallAt" TIMESTAMP(3),
    "labelledBy" TEXT,
    "labelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnownCaller_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnownCaller_receptionistId_status_idx" ON "KnownCaller"("receptionistId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KnownCaller_receptionistId_phone_key" ON "KnownCaller"("receptionistId", "phone");

-- AddForeignKey
ALTER TABLE "KnownCaller" ADD CONSTRAINT "KnownCaller_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
