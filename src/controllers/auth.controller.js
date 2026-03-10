import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/error.middleware.js';

const generateToken = (id) =>
    jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

// POST /api/auth/register
export const register = async (req, res, next) => {
    try {
        const { name, email, password, businessName } = req.body;

        if (!name || !email || !password) {
            return next(new AppError('Name, email and password are required.', 400));
        }

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return next(new AppError('Email already registered.', 409));
        }

        const hashed = await bcrypt.hash(password, 12);
        const user = await prisma.user.create({
            data: { name, email, password: hashed, businessName },
        });

        const token = generateToken(user.id);
        const { password: _, ...safeUser } = user;

        res.status(201).json({ success: true, token, user: safeUser });
    } catch (err) {
        next(err);
    }
};

// POST /api/auth/login
export const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return next(new AppError('Email and password are required.', 400));
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return next(new AppError('Invalid credentials.', 401));
        }

        const token = generateToken(user.id);
        const { password: _, ...safeUser } = user;

        res.json({ success: true, token, user: safeUser });
    } catch (err) {
        next(err);
    }
};

// GET /api/auth/me
export const getMe = async (req, res, next) => {
    try {
        res.json({ success: true, user: req.user });
    } catch (err) {
        next(err);
    }
};

// PATCH /api/auth/profile
export const updateProfile = async (req, res, next) => {
    try {
        const { name, businessName, businessEmail, businessPhone, businessAddress } = req.body;
        const updated = await prisma.user.update({
            where: { id: req.user.id },
            data: { name, businessName, businessEmail, businessPhone, businessAddress },
        });
        const { password: _, ...safeUser } = updated;
        res.json({ success: true, user: safeUser });
    } catch (err) {
        next(err);
    }
};
