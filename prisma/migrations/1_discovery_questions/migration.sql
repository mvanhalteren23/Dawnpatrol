-- Questions to ask a prospect on the phone to build their demo agent's knowledge base (JSON array),
-- written by account research.
ALTER TABLE "Account" ADD COLUMN "discoveryQuestions" TEXT NOT NULL DEFAULT '';
