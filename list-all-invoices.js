import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const invoices = await prisma.invoice.findMany({
        include: { customer: true },
        orderBy: { createdAt: 'desc' }
    });

    console.log("Invoice Summary:");
    invoices.forEach(inv => {
        console.log(`${inv.invoiceNumber} | Customer: ${inv.customer?.companyName} | isConsignment: ${inv.customer?.isConsignment}`);
    });
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
