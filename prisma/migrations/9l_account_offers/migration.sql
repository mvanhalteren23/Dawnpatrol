-- Special offers for one account (discount and/or free months), applied on its checkout link.
CREATE TABLE "AccountOffer" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "percentOff" INTEGER,
  "amountOffCents" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'CAD',
  "durationMonths" INTEGER,
  "trialMonths" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "createdById" TEXT,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountOffer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountOffer_accountId_key" ON "AccountOffer"("accountId");
ALTER TABLE "AccountOffer" ADD CONSTRAINT "AccountOffer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
