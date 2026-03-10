import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const latestInvoice = await prisma.invoice.findFirst({
        orderBy: { createdAt: 'desc' },
        include: { customer: true }
    });

    console.log("Latest Invoice Details:");
    console.log(JSON.stringify({
        invoiceNumber: latestInvoice?.invoiceNumber,
        customerName: latestInvoice?.customer?.companyName,
        isConsignment: latestInvoice?.customer?.isConsignment,
        createdAt: latestInvoice?.createdAt
    }, null, 2));

    const consignmentCustomers = await prisma.customer.findMany({
        where: { isConsignment: true },
        select: { companyName: true }
    });
    console.log("\nCustomers marked as Consignment:");
    console.log(consignmentCustomers.map(c => c.companyName));
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
