import { Router } from 'express';
import { register, login, getMe, updateProfile, forgotPassword } from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.patch('/profile', protect, updateProfile);
router.post('/forgot-password', forgotPassword);

export default router;
