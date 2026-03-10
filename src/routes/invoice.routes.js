import { Router } from 'express';
import {
    getInvoices,
    getInvoice,
    createInvoice,
    updateInvoiceStatus,
    sendInvoice,
    downloadInvoice,
    deleteInvoice,
    getInvoiceAnalytics,
    getReportsAnalytics,
} from '../controllers/invoice.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = Router();

router.use(protect);

router.route('/').get(getInvoices).post(createInvoice);
router.get('/analytics/summary', getInvoiceAnalytics);
router.get('/analytics/reports', getReportsAnalytics);
router.route('/:id').get(getInvoice).delete(deleteInvoice);
router.patch('/:id/status', updateInvoiceStatus);
router.post('/:id/send', sendInvoice);
router.get('/:id/download', downloadInvoice);

export default router;
