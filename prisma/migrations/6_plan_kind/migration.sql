-- Plans or add-ons (an add-on is ticked onto a plan at checkout, e.g. the Follow-Up Agent).
ALTER TABLE "Plan" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'plan';
