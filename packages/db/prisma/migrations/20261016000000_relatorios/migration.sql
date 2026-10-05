
-- AlterTable
ALTER TABLE "AutopilotSettings" ADD COLUMN     "trackClicks" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Post_tenantId_groupId_sentAt_idx" ON "Post"("tenantId", "groupId", "sentAt");

-- CreateIndex
CREATE INDEX "Click_tenantId_offerId_createdAt_idx" ON "Click"("tenantId", "offerId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversion_tenantId_offerId_occurredAt_idx" ON "Conversion"("tenantId", "offerId", "occurredAt");

