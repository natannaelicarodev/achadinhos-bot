-- CreateTable
CREATE TABLE "StoreReportSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "store" "Store" NOT NULL,
    "rangeDays" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "clicks" INTEGER NOT NULL,
    "buyers" INTEGER NOT NULL,
    "orders" INTEGER NOT NULL,
    "units" INTEGER NOT NULL,
    "salesCents" INTEGER NOT NULL,
    "notEffectiveSalesCents" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreReportSnapshot_tenantId_store_rangeDays_key" ON "StoreReportSnapshot"("tenantId", "store", "rangeDays");

-- AddForeignKey
ALTER TABLE "StoreReportSnapshot" ADD CONSTRAINT "StoreReportSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

