
-- CreateEnum
CREATE TYPE "PostSource" AS ENUM ('AUTO', 'MANUAL');

-- AlterEnum
ALTER TYPE "PostStatus" ADD VALUE 'DISCARDED';

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "autopilotPauseReason" TEXT,
ADD COLUMN     "autopilotPausedAt" TIMESTAMP(3),
ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "firstConnectedAt" TIMESTAMP(3),
ADD COLUMN     "nextSendAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "sendQueuedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "affiliateUrl" TEXT,
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "messageText" TEXT,
ADD COLUMN     "priceCents" INTEGER,
ADD COLUMN     "productExternalId" TEXT,
ADD COLUMN     "source" "PostSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "store" "Store";

-- AlterTable
ALTER TABLE "StoreCredential" ADD COLUMN     "autopilotPausedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AutopilotSettings" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "weekdays" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
    "windowStartMinute" INTEGER NOT NULL DEFAULT 480,
    "windowEndMinute" INTEGER NOT NULL DEFAULT 1320,
    "offersPerHour" INTEGER NOT NULL DEFAULT 2,
    "stores" "Store"[] DEFAULT ARRAY[]::"Store"[],
    "categories" "CatalogCategory"[] DEFAULT ARRAY[]::"CatalogCategory"[],
    "minDiscountPct" INTEGER,
    "minPriceCents" INTEGER,
    "maxPriceCents" INTEGER,
    "minRating" DOUBLE PRECISION,
    "minCommissionPct" DOUBLE PRECISION,
    "groupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "repeatDays" INTEGER NOT NULL DEFAULT 3,
    "groupIntervalMinSeconds" INTEGER NOT NULL DEFAULT 30,
    "groupIntervalMaxSeconds" INTEGER NOT NULL DEFAULT 90,
    "channelDailyLimit" INTEGER NOT NULL DEFAULT 80,
    "lastPickAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE INDEX "Post_groupId_store_productExternalId_createdAt_idx" ON "Post"("groupId", "store", "productExternalId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_tenantId_sentAt_idx" ON "Post"("tenantId", "sentAt");

-- AddForeignKey
ALTER TABLE "AutopilotSettings" ADD CONSTRAINT "AutopilotSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

