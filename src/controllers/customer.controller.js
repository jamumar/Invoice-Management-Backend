import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/error.middleware.js';

// GET /api/customers
export const getCustomers = async (req, res, next) => {
    try {
        const customers = await prisma.customer.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' },
        });
        console.log(`[Customers] Fetching customers for user: ${req.user.id}`);
        res.json({ success: true, data: customers });
    } catch (err) {
        next(err);
    }
};

// GET /api/customers/:id
export const getCustomer = async (req, res, next) => {
    try {
        const customer = await prisma.customer.findFirst({
            where: { id: req.params.id, userId: req.user.id },
            include: { invoices: { orderBy: { createdAt: 'desc' } } },
        });
        if (!customer) return next(new AppError('Customer not found.', 404));
        res.json({ success: true, data: customer });
    } catch (err) {
        next(err);
    }
};

// POST /api/customers
export const createCustomer = async (req, res, next) => {
    try {
        const { companyName, contactInfo, email, phone, address, address2, city, county, postcode, paymentTerms } = req.body;
        if (!companyName || !email) return next(new AppError('Company name and email are required.', 400));

        const customer = await prisma.customer.create({
            data: { companyName, contactInfo, email, phone, address, address2, city, county, postcode, paymentTerms: paymentTerms || 'net_30', userId: req.user.id },
        });
        console.log(`[Customers] Created: ${customer.companyName} (${customer.id})`);
        res.status(201).json({ success: true, data: customer });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/customers/:id
export const updateCustomer = async (req, res, next) => {
    try {
        const existing = await prisma.customer.findFirst({ where: { id: req.params.id, userId: req.user.id } });
        if (!existing) return next(new AppError('Customer not found.', 404));

        const updated = await prisma.customer.update({
            where: { id: req.params.id },
            data: req.body,
        });
        console.log(`[Customers] Updated: ${updated.companyName}`);
        res.json({ success: true, data: updated });
    } catch (err) {
        next(err);
    }
};

// DELETE /api/customers/:id
export const deleteCustomer = async (req, res, next) => {
    try {
        const existing = await prisma.customer.findFirst({ where: { id: req.params.id, userId: req.user.id } });
        if (!existing) return next(new AppError('Customer not found.', 404));

        await prisma.customer.delete({ where: { id: req.params.id } });
        console.log(`[Customers] Deleted: ${existing.companyName} (${existing.id})`);
        res.json({ success: true, message: 'Customer deleted.' });
    } catch (err) {
        next(err);
    }
};

// GET /api/customers/:id/custom-prices
export const getCustomerCustomPrices = async (req, res, next) => {
    try {
        const prices = await prisma.customPrice.findMany({
            where: { customerId: req.params.id, userId: req.user.id }
        });
        res.json({ success: true, data: prices });
    } catch (err) {
        next(err);
    }
};
