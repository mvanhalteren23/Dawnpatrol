-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CLIENT',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "sessionsValidAfter" TIMESTAMP(3),
    "accountId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totpSecret" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "totpLastStep" INTEGER,
    "recoveryCodes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "industry" TEXT,
    "city" TEXT,
    "state" TEXT,
    "employees" INTEGER,
    "stage" TEXT NOT NULL DEFAULT 'PROSPECT',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "fitScore" INTEGER,
    "tags" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "estMissedCallsPerWeek" INTEGER,
    "avgJobValueCents" INTEGER,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "ownerId" TEXT,
    "driveFolderId" TEXT,
    "driveFolderUrl" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "linkedin" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "type" TEXT NOT NULL,
    "direction" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "threadId" TEXT,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "firstOpenedAt" TIMESTAMP(3),
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "repliedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "durationSec" INTEGER,
    "recordingSid" TEXT,
    "answeredBy" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedPrompt" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "template" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "accountId" TEXT,
    "promptId" TEXT,
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL DEFAULT '',
    "resultJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "model" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "driveFileId" TEXT,
    "driveFileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "setupFeeCents" INTEGER NOT NULL DEFAULT 0,
    "includedMinutes" INTEGER NOT NULL DEFAULT 0,
    "minimumMonths" INTEGER NOT NULL DEFAULT 0,
    "features" TEXT NOT NULL DEFAULT '',
    "stripePriceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "planId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INCOMPLETE',
    "mrrCents" INTEGER NOT NULL DEFAULT 0,
    "billingMethod" TEXT NOT NULL DEFAULT 'stripe',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT,
    "number" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "hostedUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receptionist" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Receptionist',
    "businessName" TEXT NOT NULL,
    "greeting" TEXT NOT NULL DEFAULT '',
    "persona" TEXT NOT NULL DEFAULT 'Warm, concise, professional.',
    "voiceId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "businessHours" TEXT NOT NULL DEFAULT '',
    "escalationPhone" TEXT,
    "escalationRules" TEXT NOT NULL DEFAULT '',
    "bookingUrl" TEXT,
    "extraInstructions" TEXT NOT NULL DEFAULT '',
    "elevenLabsAgentId" TEXT,
    "elevenLabsKbDocs" TEXT NOT NULL DEFAULT '[]',
    "ragToken" TEXT NOT NULL,
    "demoExtension" TEXT,
    "agentType" TEXT NOT NULL DEFAULT 'inbound',
    "followupGoal" TEXT NOT NULL DEFAULT '',
    "followupQuestions" TEXT NOT NULL DEFAULT '',
    "followupGuardrails" TEXT NOT NULL DEFAULT '',
    "followupCallHours" TEXT NOT NULL DEFAULT 'Mon-Fri 09:00-20:00
Sat-Sun 10:00-18:00',
    "followupDelaySeconds" INTEGER NOT NULL DEFAULT 60,
    "followupMaxAttempts" INTEGER NOT NULL DEFAULT 2,
    "followupTextIfMissed" BOOLEAN NOT NULL DEFAULT true,
    "leadFormKey" TEXT,
    "leadAlertOn" TEXT NOT NULL DEFAULT '',
    "leadAlertTo" TEXT NOT NULL DEFAULT '',
    "reportFrequency" TEXT NOT NULL DEFAULT '',
    "reportEmails" TEXT NOT NULL DEFAULT '',
    "existingNumber" TEXT,
    "existingCarrier" TEXT,
    "keepNumberMethod" TEXT NOT NULL DEFAULT '',
    "portStatus" TEXT NOT NULL DEFAULT '',
    "portDate" TIMESTAMP(3),
    "portNotes" TEXT NOT NULL DEFAULT '',
    "googleUserId" TEXT,
    "createdById" TEXT,
    "bookingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bookingCalendarId" TEXT NOT NULL DEFAULT 'primary',
    "bookingTitle" TEXT NOT NULL DEFAULT 'Discovery call',
    "bookingSlotMinutes" INTEGER NOT NULL DEFAULT 30,
    "bookingHours" TEXT NOT NULL DEFAULT 'Mon-Fri 09:00-17:00',
    "bookingMinNoticeHours" INTEGER NOT NULL DEFAULT 2,
    "bookingDaysAhead" INTEGER NOT NULL DEFAULT 14,
    "bookingBufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "bookingMeetingType" TEXT NOT NULL DEFAULT 'phone',
    "bookingQuestions" TEXT NOT NULL DEFAULT '',
    "bookingHolidays" TEXT NOT NULL DEFAULT '',
    "bookingClosedDates" TEXT NOT NULL DEFAULT '',
    "followUpOn" TEXT NOT NULL DEFAULT '',
    "followUpChannel" TEXT NOT NULL DEFAULT 'caller_choice',
    "businessNumber" TEXT,
    "businessNumberSid" TEXT,
    "ringFirstNumber" TEXT,
    "ringSeconds" INTEGER NOT NULL DEFAULT 20,
    "ringMode" TEXT NOT NULL DEFAULT 'hours',
    "bookingAddsToCrm" BOOLEAN NOT NULL DEFAULT false,
    "elevenLabsToolIds" TEXT NOT NULL DEFAULT '{}',
    "syncStatus" TEXT NOT NULL DEFAULT 'NEVER',
    "syncError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receptionist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpMessage" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "conversationId" TEXT,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'FAQ',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "callerNumber" TEXT,
    "callerName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL DEFAULT '',
    "transcript" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "followUpNeeded" BOOLEAN NOT NULL DEFAULT false,
    "followedUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveFolder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDraft" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "promptId" TEXT,
    "instructions" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "rating" INTEGER,
    "feedback" TEXT,
    "sentSubject" TEXT,
    "sentBody" TEXT,
    "sentActivityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoicemailAudio" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'audio/mpeg',
    "data" BYTEA NOT NULL,
    "script" TEXT,
    "accountId" TEXT,
    "durationSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoicemailAudio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '',
    "gmailCursor" INTEGER,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientReport" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "sentTo" TEXT NOT NULL,
    "totals" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsOptOut" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "message" TEXT NOT NULL DEFAULT '',
    "details" TEXT NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'form',
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "statusNote" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastCallSid" TEXT,
    "conversationId" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "calledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallAudit" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "targetNumber" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "industry" TEXT NOT NULL DEFAULT 'auto_repair',
    "timezone" TEXT NOT NULL DEFAULT 'America/Vancouver',
    "shopHours" TEXT NOT NULL DEFAULT 'Mon-Fri 08:00-17:30',
    "callsPerDay" INTEGER NOT NULL DEFAULT 3,
    "afterHoursCalls" INTEGER NOT NULL DEFAULT 3,
    "customScenarios" TEXT NOT NULL DEFAULT '',
    "callerIds" TEXT NOT NULL DEFAULT '',
    "ownerConsent" TEXT NOT NULL DEFAULT '',
    "callsPerWeek" INTEGER NOT NULL DEFAULT 90,
    "avgJobValueCents" INTEGER NOT NULL DEFAULT 45000,
    "afterHoursShare" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "newCustomerShare" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "bookingRate" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "report" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "shareToken" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditCall" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "window" TEXT NOT NULL,
    "afterHours" BOOLEAN NOT NULL DEFAULT false,
    "scenarioKey" TEXT NOT NULL,
    "callerName" TEXT NOT NULL,
    "toNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "note" TEXT NOT NULL DEFAULT '',
    "fromNumber" TEXT,
    "callSid" TEXT,
    "answeredBy" TEXT,
    "calledAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "ringSeconds" INTEGER,
    "durationSec" INTEGER,
    "conversationId" TEXT,
    "transcript" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "analysis" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleAudio" (
    "key" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'audio/mpeg',
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SampleAudio_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SecurityIncident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "description" TEXT NOT NULL DEFAULT '',
    "dataInvolved" TEXT NOT NULL DEFAULT '',
    "peopleAffected" INTEGER,
    "realRiskOfHarm" TEXT NOT NULL DEFAULT 'unknown',
    "containment" TEXT NOT NULL DEFAULT '',
    "individualsNotifiedAt" TIMESTAMP(3),
    "regulatorNotifiedAt" TIMESTAMP(3),
    "clientsNotifiedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_domain_key" ON "Account"("domain");

-- CreateIndex
CREATE INDEX "Account_stage_idx" ON "Account"("stage");

-- CreateIndex
CREATE INDEX "Contact_email_idx" ON "Contact"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_externalId_key" ON "Activity"("externalId");

-- CreateIndex
CREATE INDEX "Activity_accountId_occurredAt_idx" ON "Activity"("accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "Activity_type_dueAt_idx" ON "Activity"("type", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_accountId_key" ON "Subscription"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_stripeInvoiceId_key" ON "Invoice"("stripeInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Receptionist_elevenLabsAgentId_key" ON "Receptionist"("elevenLabsAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "Receptionist_ragToken_key" ON "Receptionist"("ragToken");

-- CreateIndex
CREATE UNIQUE INDEX "Receptionist_demoExtension_key" ON "Receptionist"("demoExtension");

-- CreateIndex
CREATE UNIQUE INDEX "Receptionist_leadFormKey_key" ON "Receptionist"("leadFormKey");

-- CreateIndex
CREATE UNIQUE INDEX "Receptionist_businessNumber_key" ON "Receptionist"("businessNumber");

-- CreateIndex
CREATE INDEX "FollowUpMessage_receptionistId_createdAt_idx" ON "FollowUpMessage"("receptionistId", "createdAt");

-- CreateIndex
CREATE INDEX "FollowUpMessage_conversationId_idx" ON "FollowUpMessage"("conversationId");

-- CreateIndex
CREATE INDEX "KnowledgeItem_receptionistId_category_idx" ON "KnowledgeItem"("receptionistId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "CallLog_externalId_key" ON "CallLog"("externalId");

-- CreateIndex
CREATE INDEX "CallLog_receptionistId_startedAt_idx" ON "CallLog"("receptionistId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DriveFolder_accountId_purpose_key" ON "DriveFolder"("accountId", "purpose");

-- CreateIndex
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_task_createdAt_idx" ON "AiUsage"("task", "createdAt");

-- CreateIndex
CREATE INDEX "EmailDraft_createdAt_idx" ON "EmailDraft"("createdAt");

-- CreateIndex
CREATE INDEX "VoicemailAudio_accountId_createdAt_idx" ON "VoicemailAudio"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAccount_userId_key" ON "GoogleAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientReport_receptionistId_periodKey_key" ON "ClientReport"("receptionistId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "SmsOptOut_receptionistId_phone_key" ON "SmsOptOut"("receptionistId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_conversationId_key" ON "Lead"("conversationId");

-- CreateIndex
CREATE INDEX "Lead_status_nextAttemptAt_idx" ON "Lead"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Lead_receptionistId_createdAt_idx" ON "Lead"("receptionistId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CallAudit_shareToken_key" ON "CallAudit"("shareToken");

-- CreateIndex
CREATE INDEX "CallAudit_status_idx" ON "CallAudit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AuditCall_callSid_key" ON "AuditCall"("callSid");

-- CreateIndex
CREATE UNIQUE INDEX "AuditCall_conversationId_key" ON "AuditCall"("conversationId");

-- CreateIndex
CREATE INDEX "AuditCall_auditId_scheduledAt_idx" ON "AuditCall"("auditId", "scheduledAt");

-- CreateIndex
CREATE INDEX "AuditCall_status_scheduledAt_idx" ON "AuditCall"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedPrompt" ADD CONSTRAINT "SavedPrompt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "SavedPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receptionist" ADD CONSTRAINT "Receptionist_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpMessage" ADD CONSTRAINT "FollowUpMessage_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveFolder" ADD CONSTRAINT "DriveFolder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAccount" ADD CONSTRAINT "GoogleAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReport" ADD CONSTRAINT "ClientReport_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsOptOut" ADD CONSTRAINT "SmsOptOut_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallAudit" ADD CONSTRAINT "CallAudit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditCall" ADD CONSTRAINT "AuditCall_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "CallAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

