-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChannelStatus" ADD VALUE 'QR_PENDING';
ALTER TYPE "ChannelStatus" ADD VALUE 'LOGGED_OUT';

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "lastConnectedAt" TIMESTAMP(3),
ADD COLUMN     "statusReason" TEXT;

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "canSend" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "participantsCount" INTEGER,
ADD COLUMN     "postingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WhatsAppSession" (
    "channelId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSession_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "WhatsAppSessionKey" (
    "channelId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSessionKey_pkey" PRIMARY KEY ("channelId","type","keyId")
);

-- CreateIndex
CREATE INDEX "WhatsAppSession_tenantId_idx" ON "WhatsAppSession"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSession_channelId_tenantId_key" ON "WhatsAppSession"("channelId", "tenantId");

-- CreateIndex
CREATE INDEX "WhatsAppSessionKey_tenantId_idx" ON "WhatsAppSessionKey"("tenantId");

-- CreateIndex
CREATE INDEX "Channel_type_status_idx" ON "Channel"("type", "status");

-- CreateIndex
CREATE INDEX "Group_tenantId_postingEnabled_idx" ON "Group"("tenantId", "postingEnabled");

-- AddForeignKey
ALTER TABLE "WhatsAppSession" ADD CONSTRAINT "WhatsAppSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSession" ADD CONSTRAINT "WhatsAppSession_channelId_tenantId_fkey" FOREIGN KEY ("channelId", "tenantId") REFERENCES "Channel"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSessionKey" ADD CONSTRAINT "WhatsAppSessionKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSessionKey" ADD CONSTRAINT "WhatsAppSessionKey_channelId_tenantId_fkey" FOREIGN KEY ("channelId", "tenantId") REFERENCES "Channel"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
