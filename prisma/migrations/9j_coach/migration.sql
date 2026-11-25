-- Sales coach: call scripts (tested in the dialer), which script each call used, and coach reviews.
CREATE TABLE "CallScript" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'testing',
  "notes" TEXT NOT NULL DEFAULT '',
  "parentId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallScript_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CoachReview" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "params" TEXT NOT NULL DEFAULT '{}',
  "result" TEXT NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'DONE',
  "error" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoachReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CoachReview_createdAt_idx" ON "CoachReview"("createdAt");
ALTER TABLE "Activity" ADD COLUMN "scriptId" TEXT;
CREATE INDEX "Activity_scriptId_idx" ON "Activity"("scriptId");
