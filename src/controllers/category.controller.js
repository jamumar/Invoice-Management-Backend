import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/error.middleware.js';

// GET /api/categories
export const getCategories = async (req, res, next) => {
    try {
        const { parentId } = req.query;
        const where = {};

        if (parentId !== 'all') {
            where.parentId = parentId || null;
        }

        const categories = await prisma.category.findMany({
            where,
            include: {
                _count: {
                    select: { children: true, products: true }
                }
            },
            orderBy: { name: 'asc' },
        });

        res.json({ success: true, data: categories });
    } catch (err) {
        next(err);
    }
};

// GET /api/categories/tree
export const getCategoryTree = async (req, res, next) => {
    try {
        const categories = await prisma.category.findMany({
            where: {},
            include: {
                _count: {
                    select: { products: true }
                }
            },
        });

        // Simple helper to build tree
        const buildTree = (list, parentId = null) => {
            return list
                .filter(item => item.parentId === parentId)
                .map(item => ({
                    ...item,
                    children: buildTree(list, item.id)
                }));
        };

        const tree = buildTree(categories);
        res.json({ success: true, data: tree });
    } catch (err) {
        next(err);
    }
};

// POST /api/categories
export const createCategory = async (req, res, next) => {
    try {
        const { name, parentId, color, bg } = req.body;
        if (!name) return next(new AppError('Category name is required.', 400));

        // Check if parent exists and belongs to user
        if (parentId) {
            const parent = await prisma.category.findFirst({
                where: { id: parentId }
            });
            if (!parent) return next(new AppError('Parent category not found.', 404));
        }

        const category = await prisma.category.create({
            data: {
                name,
                color,
                bg,
                parentId: parentId || null,
                userId: req.user.id
            },
        });

        res.status(201).json({ success: true, data: category });
    } catch (err) {
        if (err.code === 'P2002') {
            return next(new AppError('A category with this name already exists at this level.', 400));
        }
        next(err);
    }
};

// PATCH /api/categories/:id
export const updateCategory = async (req, res, next) => {
    try {
        const { name, parentId, color, bg } = req.body;
        const existing = await prisma.category.findFirst({
            where: { id: req.params.id }
        });
        if (!existing) return next(new AppError('Category not found.', 404));

        const data = {};
        if (name) data.name = name;
        if (color) data.color = color;
        if (bg) data.bg = bg;
        if (parentId !== undefined) {
            if (parentId === req.params.id) return next(new AppError('Category cannot be its own parent.', 400));
            data.parentId = parentId;
        }

        const updated = await prisma.category.update({
            where: { id: req.params.id },
            data
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        next(err);
    }
};

// DELETE /api/categories/:id
export const deleteCategory = async (req, res, next) => {
    try {
        const existing = await prisma.category.findFirst({
            where: { id: req.params.id },
            include: { children: true, products: true }
        });
        if (!existing) return next(new AppError('Category not found.', 404));

        if (existing.children.length > 0) {
            return next(new AppError('Cannot delete category with subcategories. Delete them first.', 400));
        }

        // What to do with products? Plan says SetNull on Product model, so we are safe.
        await prisma.category.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: 'Category deleted.' });
    } catch (err) {
        next(err);
    }
};
