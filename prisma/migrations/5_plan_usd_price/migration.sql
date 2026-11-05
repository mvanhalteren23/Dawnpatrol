-- A USD Stripe price per plan, for US clients (CAD stays in stripePriceId).
ALTER TABLE "Plan" ADD COLUMN "stripePriceIdUsd" TEXT;
