-- AlterTable
ALTER TABLE "ConsignmentVisit" ADD COLUMN     "nextVisit" TEXT,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "date" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ConsignmentStock" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stocked" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,

    CONSTRAINT "ConsignmentStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsignmentStock_customerId_code_key" ON "ConsignmentStock"("customerId", "code");

-- AddForeignKey
ALTER TABLE "ConsignmentStock" ADD CONSTRAINT "ConsignmentStock_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
