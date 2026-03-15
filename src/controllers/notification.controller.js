import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/error.middleware.js';

// GET /api/notifications
export const getNotifications = async (req, res, next) => {
    try {
        const notifications = await prisma.notification.findMany({
            where: {},
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json({ success: true, data: notifications });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/notifications/:id/read
export const markAsRead = async (req, res, next) => {
    try {
        const notification = await prisma.notification.findFirst({
            where: { id: req.params.id }
        });

        if (!notification) return next(new AppError('Notification not found', 404));

        const updated = await prisma.notification.update({
            where: { id: req.params.id },
            data: { unread: false }
        });

        res.json({ success: true, data: updated });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/notifications/read-all
export const markAllRead = async (req, res, next) => {
    try {
        await prisma.notification.updateMany({
            where: { unread: true },
            data: { unread: false }
        });
        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (err) {
        next(err);
    }
};

// DELETE /api/notifications
export const clearNotifications = async (req, res, next) => {
    try {
        await prisma.notification.deleteMany({
            where: {}
        });
        res.json({ success: true, message: 'Notifications cleared' });
    } catch (err) {
        next(err);
    }
};

// Helper for internal use to create notifications
export const createInternalNotification = async ({ userId, type, title, body, invoiceId, productId }) => {
    try {
        return await prisma.notification.create({
            data: {
                userId,
                type,
                title,
                body,
                invoiceId,
                productId
            }
        });
    } catch (err) {
        console.error('[Notification] Error creating internal notification:', err);
    }
};
