-- Assistant tier: the owner's feedback ("coaching"), turned into short rules the agent follows.

-- AlterTable
ALTER TABLE "Receptionist" ADD COLUMN     "coaching" TEXT NOT NULL DEFAULT '';
