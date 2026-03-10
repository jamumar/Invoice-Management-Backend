import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { AppError } from './error.middleware.js';

export const protect = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            token = req.headers.authorization.split(' ')[1];
        } else if (req.query.token) {
            token = req.query.token;
        }

        if (!token) {
            return next(new AppError('Not authorized. No token provided.', 401));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: { id: true, email: true, name: true, businessName: true, businessEmail: true, businessPhone: true, businessAddress: true },
        });

        if (!user) {
            return next(new AppError('User no longer exists.', 401));
        }

        req.user = user;
        next();
    } catch (err) {
        return next(new AppError('Not authorized. Token invalid.', 401));
    }
};
