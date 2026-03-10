import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/error.middleware.js';
import { createInternalNotification } from './notification.controller.js';

// GET /api/products
export const getProducts = async (req, res, next) => {
    try {
        const products = await prisma.product.findMany({
            where: { userId: req.user.id },
            orderBy: { stock: 'desc' },
        });
        console.log(`[Products] Fetching products for user: ${req.user.id}`);
        res.json({ success: true, data: products });
    } catch (err) {
        next(err);
    }
};

// GET /api/products/:id
export const getProduct = async (req, res, next) => {
    try {
        const product = await prisma.product.findFirst({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!product) return next(new AppError('Product not found.', 404));
        res.json({ success: true, data: product });
    } catch (err) {
        next(err);
    }
};

// POST /api/products
export const createProduct = async (req, res, next) => {
    try {
        const { productCode, name, description, unitPrice, unit, stock } = req.body;
        if (!name || unitPrice === undefined) return next(new AppError('Name and unit price are required.', 400));

        const product = await prisma.product.create({
            data: {
                productCode,
                name,
                description,
                unitPrice: parseFloat(unitPrice),
                unit: unit || 'per project',
                stock: stock !== undefined ? parseInt(stock, 10) : 0,
                userId: req.user.id
            },
        });
        console.log(`[Products] Created: ${product.name} (${product.id}) with stock: ${product.stock}`);

        // Create Notification
        await createInternalNotification({
            userId: req.user.id,
            type: 'PRODUCT_ADDED',
            title: 'Product added',
            body: `"${product.name}" added to your product list.`,
            productId: product.id
        });

        res.status(201).json({ success: true, data: product });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/products/:id
export const updateProduct = async (req, res, next) => {
    try {
        const existing = await prisma.product.findFirst({ where: { id: req.params.id, userId: req.user.id } });
        if (!existing) return next(new AppError('Product not found.', 404));

        const data = { ...req.body };
        if (data.unitPrice !== undefined) data.unitPrice = parseFloat(data.unitPrice);
        if (data.stock !== undefined) data.stock = parseInt(data.stock, 10);

        const updated = await prisma.product.update({ where: { id: req.params.id }, data });
        console.log(`[Products] Updated: ${updated.name} (stock: ${updated.stock})`);
        res.json({ success: true, data: updated });
    } catch (err) {
        next(err);
    }
};

// DELETE /api/products/:id
export const deleteProduct = async (req, res, next) => {
    try {
        const existing = await prisma.product.findFirst({ where: { id: req.params.id, userId: req.user.id } });
        if (!existing) return next(new AppError('Product not found.', 404));

        await prisma.product.delete({ where: { id: req.params.id } });
        console.log(`[Products] Deleted: ${existing.name} (${existing.id})`);
        res.json({ success: true, message: 'Product deleted.' });
    } catch (err) {
        next(err);
    }
};
