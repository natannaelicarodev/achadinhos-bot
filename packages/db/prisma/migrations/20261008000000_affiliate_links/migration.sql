-- AlterEnum
ALTER TYPE "Store" ADD VALUE 'SHEIN';

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "messageText" TEXT,
ADD COLUMN     "sendRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StoreCredential" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "tenantId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("tenantId")
);

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
