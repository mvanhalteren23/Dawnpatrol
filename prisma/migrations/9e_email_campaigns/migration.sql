-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "campaignId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachInbox" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "refreshToken" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "replyCursor" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "senders" TEXT NOT NULL DEFAULT '[]',
    "dailyPerInbox" INTEGER NOT NULL DEFAULT 30,
    "sendStartHour" INTEGER NOT NULL DEFAULT 9,
    "sendEndHour" INTEGER NOT NULL DEFAULT 16,
    "timezone" TEXT NOT NULL DEFAULT 'America/Vancouver',
    "weekdaysOnly" BOOLEAN NOT NULL DEFAULT true,
    "steps" TEXT NOT NULL DEFAULT '[]',
    "buildDemoOnReply" BOOLEAN NOT NULL DEFAULT true,
    "prebuildMinFit" INTEGER,
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "step" INTEGER NOT NULL DEFAULT 0,
    "nextSendAt" TIMESTAMP(3),
    "sender" TEXT,
    "threadId" TEXT,
    "messageId" TEXT,
    "firstSubject" TEXT,
    "personalLine" TEXT,
    "emailSource" TEXT NOT NULL DEFAULT '',
    "demoRunId" TEXT,
    "note" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_value_key" ON "EmailSuppression"("value");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachInbox_email_key" ON "OutreachInbox"("email");

-- CreateIndex
CREATE INDEX "CampaignRecipient_status_nextSendAt_idx" ON "CampaignRecipient"("status", "nextSendAt");

-- CreateIndex
CREATE INDEX "CampaignRecipient_threadId_idx" ON "CampaignRecipient"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_email_key" ON "CampaignRecipient"("campaignId", "email");

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

