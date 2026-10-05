-- AlterTable
ALTER TABLE "Click" ADD COLUMN     "groupId" TEXT;

-- CreateIndex
CREATE INDEX "Click_postId_ipHash_createdAt_idx" ON "Click"("postId", "ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "Click_tenantId_groupId_createdAt_idx" ON "Click"("tenantId", "groupId", "createdAt");

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_groupId_tenantId_fkey" FOREIGN KEY ("groupId", "tenantId") REFERENCES "Group"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;

