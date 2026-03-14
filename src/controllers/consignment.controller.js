import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/error.middleware.js';
import { createInternalNotification } from './notification.controller.js';

// GET /api/consignment/customers
export const getConsignmentCustomers = async (req, res, next) => {
    try {
        const customers = await prisma.customer.findMany({
            where: { isConsignment: true },
            include: {
                consignmentVisits: {
                    include: {
                        items: {
                            select: { total: true }
                        }
                    },
                    orderBy: { date: 'desc' }
                }
            },
            orderBy: { companyName: 'asc' },
        });

        // Calculate stats for each customer
        const formatted = customers.map(c => {
            const pendingVisits = c.consignmentVisits.filter(v => !v.invoiced);
            const pendingVisitsCount = pendingVisits.length;
            const pendingValue = pendingVisits.reduce((sum, v) => {
                return sum + v.items.reduce((itemSum, item) => itemSum + item.total, 0);
            }, 0);

            const lastVisitDate = c.consignmentVisits[0]?.date || null;

            const { consignmentVisits, ...rest } = c;
            return { ...rest, pendingValue, pendingVisitsCount, lastVisitDate };
        });

        res.json({ success: true, data: formatted });
    } catch (err) {
        next(err);
    }
};

// GET /api/consignment/visits/:customerId
export const getPendingVisits = async (req, res, next) => {
    try {
        const visits = await prisma.consignmentVisit.findMany({
            where: {
                customerId: req.params.customerId,
                userId: req.user.id,
                invoiced: false
            },
            include: {
                items: {
                    include: { product: true }
                }
            },
            orderBy: { date: 'desc' },
        });

        const formatted = visits.map(v => ({
            ...v,
            totalValue: v.items.reduce((sum, item) => sum + item.total, 0)
        }));

        res.json({ success: true, data: formatted });
    } catch (err) {
        next(err);
    }
};

// POST /api/consignment/visits
export const logVisit = async (req, res, next) => {
    try {
        const { customerId, date, items } = req.body;
        if (!customerId || !items || !items.length) {
            return next(new AppError('Customer ID and items are required.', 400));
        }

        const visit = await prisma.consignmentVisit.create({
            data: {
                customerId,
                userId: req.user.id,
                date: new Date(date || Date.now()),
                items: {
                    create: items.map(item => ({
                        name: item.name,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        total: item.total,
                        productId: item.productId || null
                    }))
                }
            },
            include: { items: true }
        });

        res.status(201).json({ success: true, data: visit });
    } catch (err) {
        next(err);
    }
};

// POST /api/consignment/generate-invoice
export const generateInvoiceFromVisits = async (req, res, next) => {
    try {
        const { customerId, visitIds, dueDate, notes } = req.body;
        if (!customerId || !visitIds || !visitIds.length) {
            return next(new AppError('Customer ID and Visit IDs are required.', 400));
        }

        const visits = await prisma.consignmentVisit.findMany({
            where: {
                id: { in: visitIds },
                customerId,
                userId: req.user.id,
                invoiced: false
            },
            include: { items: true }
        });

        if (visits.length === 0) {
            return next(new AppError('No valid pending visits found.', 404));
        }

        // Merge items by name/product
        const mergedItems = {};
        visits.forEach(visit => {
            visit.items.forEach(item => {
                const key = item.productId || item.name;
                if (mergedItems[key]) {
                    mergedItems[key].quantity += item.quantity;
                    mergedItems[key].total += item.total;
                } else {
                    mergedItems[key] = {
                        name: item.name,
                        productId: item.productId,
                        unitPrice: item.unitPrice,
                        quantity: item.quantity,
                        total: item.total
                    };
                }
            });
        });

        const invoiceItems = Object.values(mergedItems);
        const subtotal = invoiceItems.reduce((sum, i) => sum + i.total, 0);
        const tax = subtotal * 0.2;
        const total = subtotal + tax;

        // Get last invoice number
        const lastInvoice = await prisma.invoice.findFirst({
            where: {},
            orderBy: { createdAt: 'desc' },
        });

        let lastNum = 0;
        if (lastInvoice && lastInvoice.invoiceNumber.includes('-')) {
            const parts = lastInvoice.invoiceNumber.split('-');
            lastNum = parseInt(parts[parts.length - 1]);
        }
        const nextNum = `INV-${new Date().getFullYear()}-${String(lastNum + 1).padStart(3, '0')}`;

        const invoice = await prisma.invoice.create({
            data: {
                invoiceNumber: nextNum,
                userId: req.user.id,
                customerId,
                issueDate: new Date(),
                dueDate: new Date(dueDate || Date.now() + 30 * 24 * 60 * 60 * 1000),
                notes: notes || `Consolidated invoice for ${visits.length} consignment visits.`,
                subtotal,
                tax,
                total,
                isConsignment: true,
                items: {
                    create: invoiceItems.map(i => ({
                        name: i.name,
                        quantity: i.quantity,
                        unitPrice: i.unitPrice,
                        total: i.total,
                        productId: i.productId
                    }))
                }
            }
        });

        // Mark visits as invoiced
        await prisma.consignmentVisit.updateMany({
            where: { id: { in: visitIds } },
            data: { invoiced: true, invoiceId: invoice.id }
        });

        // Create Notification
        await createInternalNotification({
            userId: req.user.id,
            type: 'INVOICE_CREATED',
            title: 'Consignment invoice',
            body: `${invoice.invoiceNumber} · Generated from ${visits.length} visits — £${total.toFixed(2)}`,
            invoiceId: invoice.id
        });

        console.log(`[Consignment] Generated invoice ${invoice.invoiceNumber} from ${visits.length} visits`);
        res.status(201).json({ success: true, data: invoice });
    } catch (err) {
        next(err);
    }
};
