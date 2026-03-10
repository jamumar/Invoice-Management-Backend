import express from 'express';
import { protect } from '../middleware/auth.middleware.js';
import {
    getConsignmentCustomers,
    getPendingVisits,
    logVisit,
    generateInvoiceFromVisits
} from '../controllers/consignment.controller.js';

const router = express.Router();

router.use(protect);

router.get('/customers', getConsignmentCustomers);
router.get('/customers/:customerId/pending', getPendingVisits);
router.post('/visit', logVisit);
router.post('/invoice', generateInvoiceFromVisits);

export default router;
