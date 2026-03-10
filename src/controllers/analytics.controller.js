import prisma from '../lib/prisma.js';

// GET /api/analytics/products
export const getProductAnalytics = async (req, res, next) => {
    try {
        const now = new Date();
        const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

        // Fetch all invoice items for this month and last month
        const thisMonthInvoices = await prisma.invoiceItem.findMany({
            where: {
                invoice: { userId: req.user.id, issueDate: { gte: firstDayThisMonth }, status: { not: 'DRAFT' } }
            },
            include: { product: true }
        });

        const lastMonthInvoices = await prisma.invoiceItem.findMany({
            where: {
                invoice: { userId: req.user.id, issueDate: { gte: firstDayLastMonth, lte: lastDayLastMonth }, status: { not: 'DRAFT' } }
            },
            include: { product: true }
        });

        // Fetch consignment items (only invoiced ones contribute to revenue/sales stats)
        const thisMonthConsignments = await prisma.consignmentItem.findMany({
            where: {
                visit: { userId: req.user.id, date: { gte: firstDayThisMonth }, invoiced: true }
            },
            include: { product: true }
        });

        const lastMonthConsignments = await prisma.consignmentItem.findMany({
            where: {
                visit: { userId: req.user.id, date: { gte: firstDayLastMonth, lte: lastDayLastMonth }, invoiced: true }
            },
            include: { product: true }
        });

        // Aggregate by product
        const stats = {};

        const processItems = (items, isThisMonth) => {
            items.forEach(item => {
                const key = item.productId || item.name;
                if (!stats[key]) {
                    stats[key] = {
                        name: item.name,
                        code: item.product?.productCode || 'SVC',
                        thisMonth: 0,
                        lastMonth: 0,
                        revenue: 0
                    };
                }
                if (isThisMonth) {
                    stats[key].thisMonth += item.quantity;
                    stats[key].revenue += item.total;
                } else {
                    stats[key].lastMonth += item.quantity;
                }
            });
        };

        processItems(thisMonthInvoices, true);
        processItems(thisMonthConsignments, true);
        processItems(lastMonthInvoices, false);
        processItems(lastMonthConsignments, false);

        const data = Object.values(stats).map(s => {
            const trendValue = s.thisMonth - s.lastMonth;
            return {
                ...s,
                trend: trendValue > 0 ? 'up' : trendValue < 0 ? 'down' : 'stable',
                trendValue: Math.abs(trendValue),
                avg: Number(((s.thisMonth + s.lastMonth) / 2).toFixed(1))
            };
        }).sort((a, b) => b.revenue - a.revenue);

        const totalRevenue = data.reduce((sum, p) => sum + p.revenue, 0);
        const topProduct = data.length > 0 ? data[0] : null;

        res.json({
            success: true,
            data: {
                revenue: totalRevenue,
                topProduct,
                products: data
            }
        });
    } catch (err) {
        next(err);
    }
};
