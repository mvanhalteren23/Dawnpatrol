-- Personal API keys (the Claude prospecting skill sends researched prospects into the CRM).
CREATE TABLE "ApiToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "scopes" TEXT NOT NULL DEFAULT 'prospects',
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApiToken_hash_key" ON "ApiToken"("hash");
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
