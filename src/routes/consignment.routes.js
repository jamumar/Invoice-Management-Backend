import express from 'express';
import { protect } from '../middleware/auth.middleware.js';
import {
    getConsignmentCustomers,
    getPendingVisits,
    logVisit,
    updateVisit,
    deleteVisit,
    generateInvoiceFromVisits,
    updateCustomerStock
} from '../controllers/consignment.controller.js';

const router = express.Router();

router.use(protect);

router.get('/customers', getConsignmentCustomers);
router.get('/customers/:customerId/pending', getPendingVisits);
router.put('/customers/:id/stock', updateCustomerStock);
router.post('/visits', logVisit);
router.patch('/visits/:id', updateVisit);
router.delete('/visits/:id', deleteVisit);
router.post('/invoice', generateInvoiceFromVisits);

export default router;
