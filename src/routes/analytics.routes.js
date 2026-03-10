import express from 'express';
import { protect } from '../middleware/auth.middleware.js';
import { getProductAnalytics } from '../controllers/analytics.controller.js';

const router = express.Router();

router.use(protect);

router.get('/products', getProductAnalytics);

export default router;
