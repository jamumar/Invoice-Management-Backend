import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🧹 Starting database cleanup...');

    try {
        // Order of deletion matters to avoid foreign key constraints
        // Delete in reverse order of dependencies
        await prisma.notification.deleteMany();
        await prisma.invoiceItem.deleteMany();
        await prisma.invoice.deleteMany();
        await prisma.product.deleteMany();
        await prisma.subcategory.deleteMany();
        await prisma.category.deleteMany();
        await prisma.customer.deleteMany();
        await prisma.user.deleteMany();

        console.log('✅ Database cleaned successfully.');
    } catch (error) {
        console.error('❌ Error cleaning database:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
