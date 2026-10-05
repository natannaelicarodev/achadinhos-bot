-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "aiCaptionsPerMonth" INTEGER,
ADD COLUMN     "annualPriceCents" INTEGER NOT NULL DEFAULT 0;

