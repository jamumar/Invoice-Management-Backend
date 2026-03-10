/*
  Warnings:

  - You are about to drop the column `name` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `Product` table. All the data in the column will be lost.
  - Added the required column `companyName` to the `Customer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unitPrice` to the `Product` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "name",
ADD COLUMN     "companyName" TEXT NOT NULL,
ADD COLUMN     "contactInfo" TEXT;

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "price",
ADD COLUMN     "unitPrice" DOUBLE PRECISION NOT NULL;
