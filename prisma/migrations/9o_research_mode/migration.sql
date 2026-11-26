-- How a research run treats what is already known: full | gaps | update.
ALTER TABLE "ResearchRun" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'full';
