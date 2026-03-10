-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "isConsignment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "stock" INTEGER NOT NULL DEFAULT 0;
