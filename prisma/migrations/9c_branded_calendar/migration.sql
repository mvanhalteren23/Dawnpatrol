-- AlterTable
ALTER TABLE "Receptionist" ADD COLUMN     "brandColor" TEXT,
ADD COLUMN     "brandLogoUrl" TEXT,
ADD COLUMN     "calendarFeedToken" TEXT,
ADD COLUMN     "emailReplyTo" TEXT,
ADD COLUMN     "emailSignOff" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "CalendarBlock" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Blocked',
    "source" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientCalendar" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '',
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "connectedBy" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,

    CONSTRAINT "ClientCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarBlock_receptionistId_start_idx" ON "CalendarBlock"("receptionistId", "start");

-- CreateIndex
CREATE UNIQUE INDEX "ClientCalendar_receptionistId_key" ON "ClientCalendar"("receptionistId");

-- CreateIndex
CREATE UNIQUE INDEX "Receptionist_calendarFeedToken_key" ON "Receptionist"("calendarFeedToken");

-- AddForeignKey
ALTER TABLE "CalendarBlock" ADD CONSTRAINT "CalendarBlock_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCalendar" ADD CONSTRAINT "ClientCalendar_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

