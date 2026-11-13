-- AlterTable
ALTER TABLE "Receptionist" ADD COLUMN     "photoTextsOn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "recognizeCallers" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "SmsMedia" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "messageSid" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsMedia_messageSid_idx" ON "SmsMedia"("messageSid");

-- CreateIndex
CREATE INDEX "SmsMedia_receptionistId_createdAt_idx" ON "SmsMedia"("receptionistId", "createdAt");

-- AddForeignKey
ALTER TABLE "SmsMedia" ADD CONSTRAINT "SmsMedia_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

