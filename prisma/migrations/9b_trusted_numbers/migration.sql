-- CreateTable
CREATE TABLE "TrustedNumber" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedNumber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrustedNumber_receptionistId_phone_key" ON "TrustedNumber"("receptionistId", "phone");

-- AddForeignKey
ALTER TABLE "TrustedNumber" ADD CONSTRAINT "TrustedNumber_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The demo line now uses the company receptionist's own limits: 6 calls per caller a day, 2 at once.
UPDATE "Receptionist" SET "callerDailyCalls" = 6, "maxConcurrentCalls" = 2 WHERE "bookingAddsToCrm" = true AND "agentType" = 'inbound';
