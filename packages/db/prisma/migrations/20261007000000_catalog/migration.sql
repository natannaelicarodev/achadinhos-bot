-- CreateEnum
CREATE TYPE "CatalogCategory" AS ENUM ('FOOD_BEVERAGES', 'BEAUTY', 'HOME_KITCHEN_DECOR', 'ELECTRONICS', 'KIDS_BABY', 'FASHION', 'PETS', 'HEALTH', 'OTHER');

-- CreateEnum
CREATE TYPE "MiningRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "catalogProductId" TEXT;

-- CreateTable
CREATE TABLE "CatalogProduct" (
    "id" TEXT NOT NULL,
    "store" "Store" NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "imageUrl" TEXT,
    "productUrl" TEXT NOT NULL,
    "category" "CatalogCategory" NOT NULL DEFAULT 'OTHER',
    "priceCents" INTEGER NOT NULL,
    "originalPriceCents" INTEGER,
    "discountPct" INTEGER,
    "commissionPct" DOUBLE PRECISION,
    "commissionCents" INTEGER,
    "rating" DOUBLE PRECISION,
    "soldCount" INTEGER,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "tenantId" TEXT NOT NULL,
    "catalogProductId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("tenantId","catalogProductId")
);

-- CreateTable
CREATE TABLE "CatalogMiningRun" (
    "id" TEXT NOT NULL,
    "store" "Store" NOT NULL,
    "status" "MiningRunStatus" NOT NULL,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "upserted" INTEGER NOT NULL DEFAULT 0,
    "deactivated" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CatalogMiningRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogProduct_active_score_idx" ON "CatalogProduct"("active", "score" DESC);

-- CreateIndex
CREATE INDEX "CatalogProduct_active_category_score_idx" ON "CatalogProduct"("active", "category", "score" DESC);

-- CreateIndex
CREATE INDEX "CatalogProduct_active_store_score_idx" ON "CatalogProduct"("active", "store", "score" DESC);

-- CreateIndex
CREATE INDEX "CatalogProduct_store_lastSeenAt_idx" ON "CatalogProduct"("store", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogProduct_store_externalId_key" ON "CatalogProduct"("store", "externalId");

-- CreateIndex
CREATE INDEX "Favorite_catalogProductId_idx" ON "Favorite"("catalogProductId");

-- CreateIndex
CREATE INDEX "CatalogMiningRun_store_startedAt_idx" ON "CatalogMiningRun"("store", "startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Offer_tenantId_catalogProductId_key" ON "Offer"("tenantId", "catalogProductId");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
