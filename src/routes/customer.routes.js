import { Router } from 'express';
import {
    getCustomers,
    getCustomer,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    getCustomerCustomPrices,
} from '../controllers/customer.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = Router();

router.use(protect);

router.route('/').get(getCustomers).post(createCustomer);
router.route('/:id').get(getCustomer).patch(updateCustomer).delete(deleteCustomer);
router.route('/:id/custom-prices').get(getCustomerCustomPrices);

export default router;
