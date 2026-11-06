-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "OwnerUpdate" (
    "id" TEXT NOT NULL,
    "receptionistId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "byPhone" TEXT NOT NULL,
    "request" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "undo" TEXT NOT NULL DEFAULT '{}',
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnerUpdate_receptionistId_createdAt_idx" ON "OwnerUpdate"("receptionistId", "createdAt");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- AddForeignKey
ALTER TABLE "OwnerUpdate" ADD CONSTRAINT "OwnerUpdate_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "Receptionist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
