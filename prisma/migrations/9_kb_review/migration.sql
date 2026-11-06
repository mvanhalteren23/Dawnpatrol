-- CreateTable
CREATE TABLE "KbReviewLink" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sentTo" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),
    "changes" INTEGER NOT NULL DEFAULT 0,
    "finishedAt" TIMESTAMP(3),
    "finishNote" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "KbReviewLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KbReviewLink_token_key" ON "KbReviewLink"("token");

-- CreateIndex
CREATE INDEX "KbReviewLink_receptionistId_createdAt_idx" ON "KbReviewLink"("receptionistId", "createdAt");

-- AddForeignKey
ALTER TABLE "KbReviewLink" ADD CONSTRAINT "KbReviewLink_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
