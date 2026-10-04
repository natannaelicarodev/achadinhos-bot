-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Group_channelId_isAdmin_idx" ON "Group"("channelId", "isAdmin");
