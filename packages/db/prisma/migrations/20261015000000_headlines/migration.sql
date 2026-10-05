-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "headline" TEXT;

-- AlterTable
ALTER TABLE "CatalogProduct" ADD COLUMN     "headlineKey" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "headline" TEXT;

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "autoHeadlines" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "customHeadlines" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "CatalogProduct_headlineKey_idx" ON "CatalogProduct"("headlineKey");

