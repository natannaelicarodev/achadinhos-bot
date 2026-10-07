-- CreateEnum
CREATE TYPE "EntitlementSource" AS ENUM ('TRIAL', 'PAYMENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('SUBSCRIPTION', 'UPGRADE');

-- CreateEnum
CREATE TYPE "BillingActor" AS ENUM ('SYSTEM', 'USER', 'ADMIN', 'ASAAS');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "billingCycle" "BillingCycle",
ADD COLUMN     "expectedCents" INTEGER,
ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'SUBSCRIPTION',
ADD COLUMN     "planId" TEXT,
ADD COLUMN     "reviewReason" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "pendingAmountCents" INTEGER;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "billingDocumentHash" TEXT,
ADD COLUMN     "billingLockUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "billingCycle" "BillingCycle",
    "source" "EntitlementSource" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "asaasPaymentId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actor" "BillingActor" NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Entitlement_tenantId_startsAt_endsAt_idx" ON "Entitlement"("tenantId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Entitlement_asaasPaymentId_idx" ON "Entitlement"("asaasPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_id_tenantId_key" ON "Entitlement"("id", "tenantId");

-- CreateIndex
CREATE INDEX "BillingAuditLog_tenantId_createdAt_idx" ON "BillingAuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAuditLog_id_tenantId_key" ON "BillingAuditLog"("id", "tenantId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "Tenant_billingDocumentHash_idx" ON "Tenant"("billingDocumentHash");

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAuditLog" ADD CONSTRAINT "BillingAuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

