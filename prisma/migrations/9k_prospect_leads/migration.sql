-- Researched leads: businesses found paying for leads, reviewed before they become accounts.
CREATE TABLE "ProspectLead" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "domain" TEXT,
  "website" TEXT,
  "phone" TEXT,
  "industry" TEXT,
  "city" TEXT,
  "region" TEXT,
  "searchIndustry" TEXT NOT NULL DEFAULT '',
  "searchRegion" TEXT NOT NULL DEFAULT '',
  "channels" TEXT NOT NULL DEFAULT '{}',
  "evidence" TEXT NOT NULL DEFAULT '[]',
  "signals" TEXT NOT NULL DEFAULT '[]',
  "notes" TEXT NOT NULL DEFAULT '',
  "googleRating" DOUBLE PRECISION,
  "reviewCount" INTEGER,
  "score" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "accountId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'skill',
  "seenCount" INTEGER NOT NULL DEFAULT 1,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectLead_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProspectLead_status_score_idx" ON "ProspectLead"("status", "score");
CREATE INDEX "ProspectLead_domain_idx" ON "ProspectLead"("domain");
CREATE INDEX "ProspectLead_phone_idx" ON "ProspectLead"("phone");
