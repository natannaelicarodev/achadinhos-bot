-- AlterTable
ALTER TABLE "Conversion" ADD COLUMN     "clickedAt" TIMESTAMP(3),
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "status" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Conversion_tenantId_groupId_occurredAt_idx" ON "Conversion"("tenantId", "groupId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_groupId_tenantId_fkey" FOREIGN KEY ("groupId", "tenantId") REFERENCES "Group"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

