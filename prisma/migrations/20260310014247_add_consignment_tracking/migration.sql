-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "isConsignment" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ConsignmentVisit" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,

    CONSTRAINT "ConsignmentVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "visitId" TEXT NOT NULL,
    "productId" TEXT,

    CONSTRAINT "ConsignmentItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ConsignmentVisit" ADD CONSTRAINT "ConsignmentVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentVisit" ADD CONSTRAINT "ConsignmentVisit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentVisit" ADD CONSTRAINT "ConsignmentVisit_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentItem" ADD CONSTRAINT "ConsignmentItem_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "ConsignmentVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentItem" ADD CONSTRAINT "ConsignmentItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
