import { Router } from 'express';
import { register, login, getMe, updateProfile, forgotPassword, changePassword } from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.patch('/profile', protect, updateProfile);
router.patch('/change-password', protect, changePassword);
router.post('/forgot-password', forgotPassword);


export default router;
