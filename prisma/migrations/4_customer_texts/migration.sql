-- Bookings, customer texts, open questions and owner check-ins; per-receptionist settings.
-- AlterTable
ALTER TABLE "Receptionist" ADD COLUMN     "bookingKey" TEXT,
ADD COLUMN     "checkinPhone" TEXT,
ADD COLUMN     "checkinThreshold" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "checkinsOn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "remindersOn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rescueTextsOn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reviewDelayHours" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "reviewLink" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reviewRequestsOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsAgentOn" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "eventId" TEXT,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "googleUserId" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "source" TEXT NOT NULL DEFAULT 'call',
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "reminderSentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "noShowTextAt" TIMESTAMP(3),
    "reviewAskedAt" TIMESTAMP(3),
    "replacesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'chat',
    "body" TEXT NOT NULL,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenQuestion" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'caller',
    "question" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "askedCount" INTEGER NOT NULL DEFAULT 1,
    "callId" TEXT,
    "holidayDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "answeredBy" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerCheckin" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "questionIds" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CALLING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "callSid" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "OwnerCheckin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Booking_receptionistId_start_idx" ON "Booking"("receptionistId", "start");

-- CreateIndex
CREATE INDEX "Booking_status_start_idx" ON "Booking"("status", "start");

-- CreateIndex
CREATE INDEX "SmsMessage_receptionistId_phone_createdAt_idx" ON "SmsMessage"("receptionistId", "phone", "createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_phone_createdAt_idx" ON "SmsMessage"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "OpenQuestion_receptionistId_status_idx" ON "OpenQuestion"("receptionistId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OpenQuestion_receptionistId_key_key" ON "OpenQuestion"("receptionistId", "key");

-- CreateIndex
CREATE INDEX "OwnerCheckin_receptionistId_createdAt_idx" ON "OwnerCheckin"("receptionistId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receptionist_bookingKey_key" ON "Receptionist"("bookingKey");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenQuestion" ADD CONSTRAINT "OpenQuestion_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerCheckin" ADD CONSTRAINT "OwnerCheckin_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

