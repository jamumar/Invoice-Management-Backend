import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/error.middleware.js';
import { createInternalNotification } from './notification.controller.js';

// GET /api/consignment/customers
export const getConsignmentCustomers = async (req, res, next) => {
    try {
        const customers = await prisma.customer.findMany({
            where: { isConsignment: true },
            include: {
                consignmentStock: true,
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

            return { ...c, stockList: c.consignmentStock, pendingValue, pendingVisitsCount, lastVisitDate };
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
        const { customerId, date, nextVisit, notes, items } = req.body;
        if (!customerId || !items || !items.length) {
            return next(new AppError('Customer ID and items are required.', 400));
        }

        const visit = await prisma.consignmentVisit.create({
            data: {
                customerId,
                userId: req.user.id,
                date: new Date(date || Date.now()),
                nextVisit: nextVisit || null,
                notes: notes || null,
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
                    // If multiple visits for same item, we can just keep the latest or use a range
                    // Here we'll just keep the existing date if one is set
                } else {
                    mergedItems[key] = {
                        name: item.name,
                        productId: item.productId,
                        unitPrice: item.unitPrice,
                        quantity: item.quantity,
                        total: item.total,
                        date: visit.date // Store the visit date
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
                        productId: i.productId,
                        date: i.date // Pass the visit date here
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

// PUT /api/consignment/customers/:id/stock
export const updateCustomerStock = async (req, res, next) => {
    try {
        const { id } = req.params;
        const stockList = req.body.stockList || [];

        // Replace entire stock list in a transaction
        await prisma.$transaction([
            prisma.consignmentStock.deleteMany({
                where: { customerId: id }
            }),
            prisma.consignmentStock.createMany({
                data: stockList.map(item => ({
                    code: item.code,
                    name: item.name,
                    stocked: Number(item.stocked),
                    price: Number(item.price),
                    customerId: id
                }))
            })
        ]);

        const updatedStock = await prisma.consignmentStock.findMany({
            where: { customerId: id }
        });

        res.json({ success: true, data: updatedStock });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/consignment/visits/:id
export const updateVisit = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { date, nextVisit, notes, items } = req.body;

        const existing = await prisma.consignmentVisit.findUnique({ where: { id } });
        if (!existing) return next(new AppError('Visit not found.', 404));
        if (existing.invoiced) return next(new AppError('Cannot edit an invoiced visit.', 400));

        // Update the visit fields
        const updated = await prisma.consignmentVisit.update({
            where: { id },
            data: {
                ...(date && { date: new Date(date) }),
                ...(nextVisit !== undefined && { nextVisit: nextVisit || null }),
                ...(notes !== undefined && { notes: notes || null }),
                // If items are provided, replace them entirely
                ...(items && {
                    items: {
                        deleteMany: {},
                        create: items.map(item => ({
                            name: item.name,
                            quantity: item.quantity,
                            unitPrice: item.unitPrice,
                            total: item.total,
                            productId: item.productId || null
                        }))
                    }
                })
            },
            include: { items: true }
        });

        console.log(`[Consignment] Visit ${id} updated`);
        res.json({ success: true, data: updated });
    } catch (err) {
        next(err);
    }
};

// DELETE /api/consignment/visits/:id
export const deleteVisit = async (req, res, next) => {
    try {
        const { id } = req.params;

        const existing = await prisma.consignmentVisit.findUnique({
            where: { id },
            include: { items: true }
        });
        if (!existing) return next(new AppError('Visit not found.', 404));
        if (existing.invoiced) return next(new AppError('Cannot delete an invoiced visit.', 400));

        // Delete items first, then the visit
        await prisma.consignmentItem.deleteMany({ where: { visitId: id } });
        await prisma.consignmentVisit.delete({ where: { id } });

        console.log(`[Consignment] Visit ${id} deleted`);
        res.json({ success: true, message: 'Visit deleted successfully.' });
    } catch (err) {
        next(err);
    }
};
